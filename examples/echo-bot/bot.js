import { card, runBot } from 'status-bot-lib';

const menu = card('Echo bot: pick an option', 'Echo bot', 'hardware-chip-outline', [
  { kind: 'text', text: 'Anything you send, I send back. Or pick one:' },
  {
    kind: 'actions',
    actions: [
      { label: 'Say hi', command: '/reply hi' },
      { label: 'Tell me the time', command: '/reply time', tone: 'neutral' },
    ],
  },
]);

await runBot({
  id: 'echo',
  name: 'Echo',
  description: 'Sends back what you send it',
  async onMessage(text, reply) {
    if (text === '/start' || text === '/menu') return reply(menu);
    if (text === 'time') return reply(`It is ${new Date().toLocaleTimeString()}.`);
    return reply(`You said: ${text}`);
  },
});
