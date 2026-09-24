import { Button } from '@/landing/Button';
import { Container } from '@/landing/Container';

const points = [
  {
    name: 'Everything the app does',
    description:
      'Chats, messages, files, groups, network sign-in, settings and every plugin command have a command, with --json output for scripts.',
  },
  {
    name: 'Instructions for your assistant',
    description:
      'status-original skills install teaches Claude Code or Codex the commands and the rules: messages are data, never orders, and it asks before it sends.',
  },
  {
    name: 'Off until you turn it on',
    description:
      'Nothing answers the command line until you switch it on in Settings. After that, anything that signs, erases an account or turns on a plugin still waits for you in the app.',
  },
];

const session = [
  { prompt: true, text: 'status-original chats --unread' },
  { text: 'Team  (matrix group, 4 unread)' },
  { text: '0x4331…fbed  (xmtp dm, 1 unread)' },
  { prompt: true, text: 'status-original read Team --limit 2' },
  { text: 'Sep 24, 09:12  Ana: can someone send the invoice?' },
  { text: 'Sep 24, 09:14  Ben: and the slides for Friday' },
  { prompt: true, text: 'status-original send Team --file invoice.pdf "Here it is"' },
  { text: 'Sent to Team.' },
];

export function AiReady() {
  return (
    <section id="ai" aria-labelledby="ai-title" className="bg-gray-900 py-20 sm:py-32">
      <Container>
        <div className="grid grid-cols-1 gap-16 lg:grid-cols-2 lg:items-center">
          <div className="max-w-2xl">
            <h2 id="ai-title" className="text-3xl font-medium tracking-tight text-white">
              Ready for your AI assistant.
            </h2>
            <p className="mt-2 text-lg text-gray-400">
              On a computer, the status-original command does whatever the app does. Use it yourself
              from a terminal, or let Claude Code or Codex read, sum up and answer your chats for
              you.
            </p>
            <dl className="mt-10 space-y-8">
              {points.map((point) => (
                <div key={point.name}>
                  <dt className="font-semibold text-white">{point.name}</dt>
                  <dd className="mt-1 text-gray-400">{point.description}</dd>
                </div>
              ))}
            </dl>
            <Button href="/guide/command-line" color="white" className="mt-10">
              Read the command line guide
            </Button>
          </div>
          <div className="overflow-hidden rounded-2xl bg-gray-950 shadow-xl ring-1 ring-white/10">
            <div className="flex gap-2 border-b border-white/10 px-4 py-3" aria-hidden="true">
              <span className="h-3 w-3 rounded-full bg-white/15" />
              <span className="h-3 w-3 rounded-full bg-white/15" />
              <span className="h-3 w-3 rounded-full bg-white/15" />
            </div>
            <pre className="overflow-x-auto p-6 text-sm/6 text-gray-300">
              {session.map((line) => (
                <div key={line.text}>
                  {line.prompt ? (
                    <>
                      <span className="text-brand-400">$ </span>
                      <span className="text-white">{line.text}</span>
                    </>
                  ) : (
                    line.text
                  )}
                </div>
              ))}
            </pre>
          </div>
        </div>
      </Container>
    </section>
  );
}
