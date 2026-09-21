export interface Location {
  lat?: number;
  lng?: number;
  label?: string;
  /** The link as written, for hosts whose short links carry no coordinates. */
  url: string;
}

const MAPS_HOSTS =
  /^(?:https?:\/\/)?(?:www\.)?(?:maps\.apple\.com|maps\.google\.[a-z.]+|(?:www\.)?google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|(?:www\.)?openstreetmap\.org|osm\.org|(?:www\.)?waze\.com\/(?:ul|live-map))/i;

const PAIR = /(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/;

/** A place a link points at, or null when it is not a maps link or a geo: URI. */
export function parseLocation(url: string): Location | null {
  if (/^geo:/i.test(url)) return parseGeo(url);
  if (!MAPS_HOSTS.test(url)) return null;

  const params = queryOf(url);
  const location: Location = { url };

  const label = params.q ?? params.query ?? params.address ?? params.name ?? params.daddr;
  const coordinateParams = [params.ll, params.coordinate, params.q, params.query, params.daddr, params.center];
  for (const candidate of coordinateParams) {
    const pair = candidate ? parsePair(candidate) : null;
    if (pair) {
      Object.assign(location, pair);
      break;
    }
  }

  if (location.lat === undefined) {
    const at = url.match(/@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
    const osm = url.match(/#map=\d+\/(-?\d{1,3}(?:\.\d+)?)\/(-?\d{1,3}(?:\.\d+)?)/);
    const mlat = params.mlat && params.mlon ? `${params.mlat},${params.mlon}` : null;
    const pair = parsePair(at ? `${at[1]},${at[2]}` : osm ? `${osm[1]},${osm[2]}` : (mlat ?? ''));
    if (pair) Object.assign(location, pair);
  }

  if (label && !PAIR.test(label)) location.label = label;
  if (!location.label) {
    const place = url.match(/\/maps\/place\/([^/@?#]+)/);
    if (place) location.label = decode(place[1]);
  }

  return location;
}

function parseGeo(url: string): Location | null {
  const match = url.match(/^geo:(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/i);
  if (!match) return null;
  const params = queryOf(url);
  const location: Location = { url };

  const pair = parsePair(`${match[1]},${match[2]}`);
  if (pair && (pair.lat !== 0 || pair.lng !== 0)) Object.assign(location, pair);

  if (params.q) {
    const named = params.q.match(/^(.*?)\((.+)\)$/);
    const query = named ? named[1] : params.q;
    const queryPair = parsePair(query);
    if (queryPair && location.lat === undefined) Object.assign(location, queryPair);
    const label = named ? named[2] : queryPair ? undefined : query;
    if (label) location.label = label;
  }

  return location.lat === undefined && !location.label ? null : location;
}

/** Links a device can hand to its maps app. */
export function mapsLinks(location: Location): { apple: string; geo: string } {
  const { lat, lng, label, url } = location;
  const q = label ? encodeURIComponent(label) : undefined;
  if (lat === undefined || lng === undefined) {
    return { apple: url, geo: url.startsWith('geo:') ? url : `geo:0,0?q=${q ?? ''}` };
  }
  const ll = `${lat},${lng}`;
  return {
    apple: `https://maps.apple.com/?ll=${ll}${q ? `&q=${q}` : ''}`,
    geo: `geo:${ll}?q=${ll}${q ? `(${q})` : ''}`,
  };
}

export function coordinatesLabel(location: Location): string | null {
  if (location.lat === undefined || location.lng === undefined) return null;
  return `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`;
}

function parsePair(value: string): { lat: number; lng: number } | null {
  const match = value.match(PAIR);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function queryOf(url: string): Record<string, string> {
  const query = url.split('#')[0].split('?')[1];
  const out: Record<string, string> = {};
  for (const part of query ? query.split('&') : []) {
    const [key, ...rest] = part.split('=');
    if (key) out[decode(key)] = decode(rest.join('='));
  }
  return out;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}
