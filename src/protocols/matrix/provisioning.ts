/**
 * The login half of the mautrix bridgev2 provisioning API, reached at
 * `<homeserver>/_matrix/provision/<bridge>/` with the user's Matrix token.
 * https://github.com/mautrix/go/blob/main/bridgev2/matrix/provisioning.yaml
 */

export interface LoginFlow {
  id: string;
  name: string;
  description: string;
}

export interface InputField {
  type:
    | 'username'
    | 'password'
    | 'phone_number'
    | 'email'
    | '2fa_code'
    | 'token'
    | 'url'
    | 'domain'
    | 'select'
    | 'captcha_code';
  id: string;
  name: string;
  description?: string;
  default_value?: string;
  pattern?: string;
  options?: string[];
}

export interface CookieSource {
  type: 'cookie' | 'local_storage' | 'request_header' | 'request_body' | 'special';
  name: string;
  cookie_domain?: string;
  request_url_regex?: string;
}

export interface CookieField {
  id: string;
  required: boolean;
  sources: CookieSource[];
  pattern?: string;
}

export interface WebCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  secure?: boolean;
  http_only?: boolean;
}

export interface CookiesParams {
  url: string;
  user_agent?: string;
  initial_cookies?: WebCookie[];
  fields: CookieField[];
  extract_js?: string;
  wait_for_url_pattern?: string;
  hidden?: boolean;
}

export interface LoginStep {
  login_id: string;
  type: 'user_input' | 'cookies' | 'display_and_wait' | 'complete' | 'client_http' | 'webauthn';
  step_id: string;
  instructions?: string;
  user_input?: { fields: InputField[] };
  cookies?: CookiesParams;
  display_and_wait?: {
    type: 'qr' | 'emoji' | 'code' | 'nothing';
    data?: string;
    image_url?: string;
  };
  complete?: { user_login_id?: string };
}

export interface BridgeAccount {
  id: string;
  name: string;
  state?: { state_event?: string };
}

export interface Whoami {
  network: { displayname: string; network_id: string };
  login_flows: LoginFlow[];
  bridge_bot: string;
  logins: BridgeAccount[];
}

export type ProvisionRequest = (
  path: string,
  init?: { method?: 'GET' | 'POST'; body?: unknown }
) => Promise<unknown>;

export class BridgeProvisioning {
  constructor(private readonly request: ProvisionRequest) {}

  whoami(): Promise<Whoami> {
    return this.request('/v3/whoami') as Promise<Whoami>;
  }

  start(flowId: string): Promise<LoginStep> {
    return this.post(`/v3/login/start/${encodeURIComponent(flowId)}`);
  }

  /** Answers a form or web sign-in step. */
  submit(step: LoginStep, values: Record<string, string>): Promise<LoginStep> {
    return this.post(stepPath(step), values);
  }

  /** Resolves once the user has acted elsewhere, such as scanning a QR code. */
  wait(step: LoginStep): Promise<LoginStep> {
    return this.post(stepPath(step));
  }

  async cancel(step: LoginStep): Promise<void> {
    await this.request(`/v3/login/cancel/${encodeURIComponent(step.login_id)}`, { method: 'POST' });
  }

  private post(path: string, body?: unknown): Promise<LoginStep> {
    return this.request(path, { method: 'POST', body }) as Promise<LoginStep>;
  }
}

function stepPath(step: LoginStep): string {
  return `/v3/login/step/${[step.login_id, step.step_id, step.type].map(encodeURIComponent).join('/')}`;
}

export interface MatrixCapabilities {
  /** `null` when the session is signed out. */
  bridgeProvisioning(bridge: string): BridgeProvisioning | null;
}

/** What a web sign-in window has seen so far. */
export interface WebSnapshot {
  url: string;
  cookies: WebCookie[];
  /** What the step's `extract_js` resolved to, once it has. */
  extracted: Record<string, string> | null;
  localStorage: Record<string, string>;
}

/** The fields the page can supply; request headers and bodies are not observed. */
export function collectWebFields(
  params: CookiesParams,
  snapshot: WebSnapshot
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of params.fields) {
    for (const source of field.sources) {
      const value = sourceValue(source, snapshot);
      if (value && matches(field.pattern, value)) {
        values[field.id] = value;
        break;
      }
    }
    const extracted = snapshot.extracted?.[field.id];
    if (!values[field.id] && extracted && matches(field.pattern, extracted)) {
      values[field.id] = extracted;
    }
  }
  return values;
}

export function webFieldsComplete(params: CookiesParams, values: Record<string, string>): boolean {
  return params.fields.every((field) => !field.required || Boolean(values[field.id]));
}

/**
 * The values to submit once every required field is there. The window may
 * close itself only after `wait_for_url_pattern` matches too; a user who
 * closes it first still gets whatever was complete.
 */
export function readyWebFields(
  params: CookiesParams,
  snapshot: WebSnapshot,
  closedByUser = false
): Record<string, string> | null {
  const values = collectWebFields(params, snapshot);
  if (!webFieldsComplete(params, values)) return null;
  if (!closedByUser && params.wait_for_url_pattern) {
    try {
      if (!new RegExp(params.wait_for_url_pattern).test(snapshot.url)) return null;
    } catch {}
  }
  return values;
}

/** Hosts whose cookies the step can use: the page's own and every named cookie domain. */
export function webDomains(params: CookiesParams): string[] {
  const host = /^https?:\/\/([^/:?#]+)/i.exec(params.url)?.[1];
  const domains = new Set<string>(host ? [host] : []);
  for (const field of params.fields) {
    for (const source of field.sources) {
      if (source.type === 'cookie' && source.cookie_domain) domains.add(source.cookie_domain);
    }
  }
  return [...domains];
}

export function localStorageKeys(params: CookiesParams): string[] {
  return params.fields.flatMap((field) =>
    field.sources.filter((source) => source.type === 'local_storage').map((source) => source.name)
  );
}

/**
 * Runs in the sign-in page: keeps new-tab links in the one window, starts
 * `extract_js` once the document exists and keeps its result on `window` for
 * the app to read. Page navigations reload it.
 */
export function extractionScript(params: CookiesParams): string {
  const extract = params.extract_js ? `(${params.extract_js})` : 'null';
  return `(() => {
  window.open = (url) => {
    if (url) location.assign(new URL(url, location.href).href);
    return window;
  };
  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element && event.target.closest('a[target="_blank"]');
    if (!link || !link.href) return;
    event.preventDefault();
    location.assign(link.href);
  }, true);
  if (window.__statusLoginStarted) return;
  window.__statusLoginStarted = true;
  const run = () => {
    try {
      Promise.resolve(${extract}).then(
        (value) => { window.__statusLoginResult = JSON.stringify(value ?? null); },
        (error) => { window.__statusLoginError = String(error); }
      );
    } catch (error) {
      window.__statusLoginError = String(error);
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();`;
}

/** Evaluated repeatedly in the page; returns what `extractionScript` found as JSON. */
export function readbackScript(keys: string[]): string {
  return `JSON.stringify({
  extracted: window.__statusLoginResult ? JSON.parse(window.__statusLoginResult) : null,
  localStorage: Object.fromEntries(${JSON.stringify(keys)}.map((k) => [k, localStorage.getItem(k)]).filter(([, v]) => v !== null)),
})`;
}

function sourceValue(source: CookieSource, snapshot: WebSnapshot): string | undefined {
  switch (source.type) {
    case 'cookie': {
      const value = snapshot.cookies.find(
        (cookie) =>
          cookie.name === source.name &&
          (!source.cookie_domain || domainMatches(cookie.domain, source.cookie_domain))
      )?.value;
      return value === undefined ? undefined : decodeCookie(value);
    }
    case 'local_storage':
      return snapshot.localStorage[source.name];
    case 'special':
      return snapshot.extracted?.[source.name];
    default:
      return undefined;
  }
}

/** Browsers keep cookie values percent-encoded; bridges expect them decoded, as their cURL import does. */
function decodeCookie(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function domainMatches(cookieDomain: string, wanted: string): boolean {
  const host = cookieDomain.replace(/^\./, '');
  return host === wanted || host.endsWith(`.${wanted}`);
}

function matches(pattern: string | undefined, value: string): boolean {
  if (!pattern) return true;
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return true;
  }
}
