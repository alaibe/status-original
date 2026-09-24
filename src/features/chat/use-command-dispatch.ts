import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { parseCommand } from '@/core/commands/parser';
import { toast } from '@/design';
import { isLocalConversation, toContent } from '@/core/messaging/bots';
import type { ConversationScope } from '@/core/messaging/conversation-scope';
import { useChatStore } from '@/core/messaging/chat-store';
import type { ConversationId, MessageContent } from '@/core/messaging/types';
import { usePluginHost } from '@/core/plugins/host';
import { worksOn } from '@/core/plugins/registry';
import { errorMessage } from '@/core/errors';

import { useSupports } from './use-supports';

async function respondIn(conversationId: ConversationId, content: MessageContent | string) {
  const body = toContent(content);
  const chat = useChatStore.getState();
  if (isLocalConversation(conversationId)) await chat.postLocalMessage(conversationId, body, 'bot');
  else await chat.postPrivateMessage(conversationId, body);
}

export interface CommandDispatchOptions {
  conversationId: ConversationId;
  scope: ConversationScope;
  onSendText(text: string): Promise<string>;
  setDraft(text: string): void;
  onRunningChange(label: string | null): void;
  pendingCommand: string | null;
  onPendingCommandHandled(): void;
}

export function useCommandDispatch({
  conversationId,
  scope,
  onSendText,
  setDraft,
  onRunningChange,
  pendingCommand,
  onPendingCommandHandled,
}: CommandDispatchOptions) {
  const { registry } = usePluginHost();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { session } = useSupports(conversationId);
  const commands = useSyncExternalStore(
    registry.subscribe,
    () => registry.commandListFor(conversationId, scope),
    () => registry.commandListFor(conversationId, scope)
  ).filter(({ command }) => worksOn(command, session));

  const dispatch = useCallback(
    async (raw: string, from: 'typed' | 'action' = 'typed') => {
      const text = raw.trim();
      if (!text) return;
      const respond = (content: MessageContent | string) => respondIn(conversationId, content);
      setError(null);

      // `/draft` and `/reply` are button contracts rather than commands: nobody
      // types them, and `/reply <text>` is the published shape third-party bots
      // build inline keyboards from.
      if (from === 'action') {
        if (text.startsWith('/draft ')) return setDraft(raw.replace(/^\s*\/draft /, ''));
        if (text.startsWith('/reply '))
          return void (await onSendText(text.slice('/reply '.length)));
      }

      const parsed = commands.length > 0 ? parseCommand(text) : null;
      const entry = parsed
        ? registry.commandsFor(conversationId, scope).get(parsed.name)
        : undefined;
      if (parsed && entry && !worksOn(entry.command, session)) {
        setError(`/${parsed.name} does not work on this network.`);
        return;
      }
      if (parsed && !entry) {
        const elsewhere = registry.commands().get(parsed.name);
        const home = elsewhere ? registry.get(elsewhere.pluginId)?.manifest.name : undefined;
        setError(
          home
            ? `/${parsed.name} belongs to ${home}. Open that chat to use it.`
            : `Unknown command /${parsed.name}. Type / to see what's available.`
        );
        return;
      }

      setBusy(true);
      try {
        if (parsed && entry) {
          onRunningChange(`/${parsed.name}`);
          const result = await entry.command.run({
            rest: parsed.rest,
            args: parsed.args,
            conversationId,
            context: entry.context,
            respond,
          });
          if (result.type === 'error') await respond(result.message);
          if (result.type === 'notice') toast[result.tone ?? 'info'](result.message);
          setDraft(result.type === 'setComposer' ? result.text : '');
        } else {
          setDraft(await onSendText(text));
        }
      } catch (e) {
        const message = errorMessage(e, 'Could not send');
        if (entry) await respond(message);
        else setError(message);
      }
      setBusy(false);
      onRunningChange(null);
    },
    [
      registry,
      conversationId,
      scope,
      session,
      commands.length,
      onSendText,
      onRunningChange,
      setDraft,
    ]
  );

  const dispatched = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingCommand) {
      dispatched.current = null;
      return;
    }
    if (dispatched.current === pendingCommand) return;
    dispatched.current = pendingCommand;
    if (busy) {
      onPendingCommandHandled();
      return;
    }
    void Promise.resolve()
      .then(() => dispatch(pendingCommand, 'action'))
      .finally(onPendingCommandHandled);
  }, [pendingCommand, busy, dispatch, onPendingCommandHandled]);

  return { commands, dispatch, busy, error, setError };
}
