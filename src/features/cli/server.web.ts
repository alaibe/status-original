import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef } from 'react';

import { usePluginHost } from '@/core/plugins/host';
import { base64ToBytes, bytesToBase64 } from '@/lib/bytes';

import { requestApproval } from './approvals';
import type { CliIo } from './context';
import { runCli } from './run';

interface Request {
  type: 'request';
  argv: string[];
  tty: boolean;
  stdinTty: boolean;
}

interface Answer {
  error?: string;
  text?: string;
  data?: string;
}

type ClientMessage = Request | { type: 'reply'; seq: number; result: Answer };

interface Payload {
  id: number;
  message?: ClientMessage;
  closed?: true;
}

class Connection {
  private chain: Promise<unknown> = Promise.resolve();
  private seq = 0;
  private waiting = new Map<number, (answer: Answer) => void>();
  private end!: () => void;
  readonly closed = new Promise<void>((resolve) => {
    this.end = resolve;
  });

  constructor(private readonly id: number) {}

  /** In order: each message waits for the one before it to reach the socket. */
  send(message: Record<string, unknown>): void {
    this.chain = this.chain
      .then(() => invoke('cli_send', { id: this.id, message }))
      .catch(() => {});
  }

  async ask(message: Record<string, unknown>): Promise<Answer> {
    const seq = ++this.seq;
    const answer = new Promise<Answer>((resolve) => this.waiting.set(seq, resolve));
    this.send({ ...message, seq });
    const result = await answer;
    if (result.error) throw new Error(result.error);
    return result;
  }

  answered(seq: number, answer: Answer): void {
    this.waiting.get(seq)?.(answer);
    this.waiting.delete(seq);
  }

  close(): void {
    this.end();
    for (const resolve of this.waiting.values()) resolve({ error: 'The terminal went away.' });
    this.waiting.clear();
  }
}

function ioFor(connection: Connection, request: Request): CliIo {
  const showWindow = () => invoke<void>('cli_show');
  return {
    json: false,
    tty: request.tty,
    stdinTty: request.stdinTty,
    print: (text) => connection.send({ type: 'out', text: `${text}\n` }),
    warn: (text) => connection.send({ type: 'err', text: `${text}\n` }),
    prompt: async (text, secret = false) =>
      (await connection.ask({ type: 'prompt', text, secret })).text ?? '',
    stdin: async () => base64ToBytes((await connection.ask({ type: 'stdin' })).data ?? ''),
    readFile: async (path) =>
      base64ToBytes((await connection.ask({ type: 'read', path })).data ?? ''),
    writeFile: async (path, data) => {
      await connection.ask({ type: 'write', path, data: bytesToBase64(data) });
    },
    approve: async (text) => {
      await showWindow();
      return requestApproval(text, connection.closed);
    },
    showWindow,
    closed: connection.closed,
  };
}

export function useCliServer(): void {
  const host = usePluginHost();
  const hostRef = useRef(host);
  useEffect(() => {
    hostRef.current = host;
  }, [host]);

  useEffect(() => {
    const connections = new Map<number, Connection>();
    let stop: (() => void) | undefined;
    let cancelled = false;

    void listen<Payload>('cli://message', ({ payload: { id, message, closed } }) => {
      if (closed) {
        connections.get(id)?.close();
        connections.delete(id);
      } else if (message?.type === 'reply') {
        connections.get(id)?.answered(message.seq, message.result);
      } else if (message?.type === 'request') {
        const connection = new Connection(id);
        connections.set(id, connection);
        void runCli(message.argv, { io: ioFor(connection, message), host: hostRef.current }).then(
          (code) => connection.send({ type: 'exit', code })
        );
      }
    }).then((unlisten) => {
      if (cancelled) return unlisten();
      stop = unlisten;
      void invoke('cli_ready');
    });

    return () => {
      cancelled = true;
      stop?.();
      for (const connection of connections.values()) connection.close();
    };
  }, []);
}
