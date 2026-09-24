import { card, runBot } from 'status-bot-lib';

const HOME = process.env.WEATHER_CITY || 'Paris';
const DAILY_AT = process.env.WEATHER_DAILY_AT;

const CONDITIONS = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Showers',
  81: 'Showers',
  82: 'Violent showers',
  85: 'Snow showers',
  86: 'Snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with hail',
};

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

async function place(name) {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({ name, count: '1', language: 'en' });
  const [found] = (await getJson(url)).results ?? [];
  return found && { ...found, label: [found.name, found.country].filter(Boolean).join(', ') };
}

async function forecast({ latitude, longitude }) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude,
    longitude,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '7',
  });
  return getJson(url);
}

const round = (value) => Math.round(value);

function now(where, { current, daily }) {
  const condition = CONDITIONS[current.weather_code] ?? 'Unknown';
  const summary = `${round(current.temperature_2m)}° and ${condition.toLowerCase()} in ${where.label}`;
  return card(summary, where.label, 'sunny-outline', [
    {
      kind: 'stat',
      value: `${round(current.temperature_2m)}°`,
      label: condition,
      caption: `Feels like ${round(current.apparent_temperature)}°`,
    },
    {
      kind: 'rows',
      rows: [
        {
          label: 'Today',
          value: `${round(daily.temperature_2m_min[0])}° to ${round(daily.temperature_2m_max[0])}°`,
        },
        { label: 'Rain', value: `${daily.precipitation_probability_max[0]}%` },
        { label: 'Wind', value: `${round(current.wind_speed_10m)} km/h` },
        { label: 'Humidity', value: `${current.relative_humidity_2m}%` },
      ],
    },
    { kind: 'actions', actions: [{ label: 'Next 7 days', command: `/reply /week ${where.name}` }] },
  ]);
}

function week(where, { daily }) {
  const day = (date) =>
    new Date(`${date}T12:00`).toLocaleDateString('en', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  return card(`7 days in ${where.label}`, where.label, 'time-outline', [
    {
      kind: 'list',
      items: daily.time.map((date, i) => ({
        title: day(date),
        subtitle: `${CONDITIONS[daily.weather_code[i]] ?? 'Unknown'}, rain ${daily.precipitation_probability_max[i]}%`,
        status: `${round(daily.temperature_2m_min[i])}° / ${round(daily.temperature_2m_max[i])}°`,
      })),
    },
  ]);
}

async function report(city, render) {
  const where = await place(city);
  if (!where) return `I could not find ${city}.`;
  return render(where, await forecast(where));
}

const help = card(
  `Send a city name for its weather. /week <city> for 7 days. Home is ${HOME}.`,
  'Weather',
  'sunny-outline',
  [
    { kind: 'text', text: 'Send any city name for its weather now.' },
    {
      kind: 'actions',
      actions: [
        { label: HOME, command: `/reply ${HOME}` },
        { label: 'Next 7 days', command: `/reply /week ${HOME}`, tone: 'neutral' },
      ],
    },
  ]
);

function everyDayAt(time, run) {
  let last = '';
  setInterval(() => {
    const clock = new Date().toTimeString().slice(0, 5);
    const today = new Date().toDateString();
    if (clock === time && last !== today) {
      last = today;
      run().catch((error) => console.error('daily forecast failed:', error.message));
    }
  }, 30_000);
}

await runBot({
  id: 'weather',
  name: 'Weather',
  description: 'Weather now and for the week, from Open-Meteo',
  async onMessage(text, reply) {
    if (text === '/start' || text === '/help') return reply(help);
    if (text === '/week' || text.startsWith('/week ')) {
      return reply(await report(text.slice(5).trim() || HOME, week));
    }
    if (text.startsWith('/')) return reply(help);
    return reply(await report(text, now));
  },
  onReady({ toOwner }) {
    if (DAILY_AT) everyDayAt(DAILY_AT, async () => toOwner(await report(HOME, now)));
  },
});
