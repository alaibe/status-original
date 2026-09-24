import { card, runBot } from 'status-bot-lib';

const BASE_URL = (process.env.LLM_BASE_URL || 'http://localhost:8080/v1').replace(/\/$/, '');
const HISTORY = 20;

let model = process.env.LLM_MODEL || undefined;
let history = [];

async function llm(path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'content-type': 'application/json',
      ...(process.env.LLM_API_KEY && { authorization: `Bearer ${process.env.LLM_API_KEY}` }),
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return response.json();
}

async function models() {
  return (await llm('/models')).data.map((m) => m.id);
}

async function ask(text) {
  model ??= (await models())[0];
  if (!model) return 'llama-swap has no models configured.';

  history.push({ role: 'user', content: text });
  const { choices } = await llm('/chat/completions', {
    model,
    messages: history.slice(-HISTORY),
  });
  const answer = choices[0]?.message?.content?.trim() || '(no answer)';
  history.push({ role: 'assistant', content: answer });
  history = history.slice(-HISTORY);
  return answer;
}

function menu() {
  return card(
    `Talking to ${model ?? 'the first model'}. /models to switch, /new to start over.`,
    'llama-swap',
    'sparkles-outline',
    [
      { kind: 'text', text: `Model: ${model ?? 'the first one llama-swap lists'}` },
      {
        kind: 'actions',
        actions: [
          { label: 'New chat', command: '/reply /new' },
          { label: 'Models', command: '/reply /models', tone: 'neutral' },
        ],
      },
    ]
  );
}

await runBot({
  id: 'llama',
  name: 'llama-swap',
  description: 'Chat with the models on your llama-swap',
  async onMessage(text, reply) {
    if (text === '/start' || text === '/help') return reply(menu());
    if (text === '/new') {
      history = [];
      return reply('Starting over.');
    }
    if (text === '/models') {
      const ids = await models();
      return reply(
        card(`Models: ${ids.join(', ')}`, 'Models', 'hardware-chip-outline', [
          {
            kind: 'list',
            items: ids.map((id) => ({
              title: id,
              state: id === model ? 'on' : 'off',
              actions: [{ label: 'Use', command: `/reply /model ${id}` }],
            })),
          },
        ])
      );
    }
    if (text.startsWith('/model ')) {
      const wanted = text.slice(7).trim();
      if (!(await models()).includes(wanted)) return reply(`llama-swap has no model ${wanted}.`);
      model = wanted;
      history = [];
      return reply(`Now using ${model}. Starting over.`);
    }
    return reply(await ask(text));
  },
});
