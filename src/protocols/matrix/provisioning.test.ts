import { MatrixSession } from './adapter';
import {
  collectWebFields,
  readyWebFields,
  localStorageKeys,
  webDomains,
  webFieldsComplete,
  type CookiesParams,
  type LoginStep,
  type WebSnapshot,
} from './provisioning';
import { FakeMatrix, flush, PARAMETERS, SESSION } from './testing/fake-matrix';

const SLACK_TOKEN: CookiesParams = {
  url: 'https://slack.com/signin',
  fields: [
    {
      id: 'auth_token',
      required: true,
      sources: [
        { type: 'special', name: 'fi.mau.slack.auth_token' },
        { type: 'request_body', name: 'token' },
      ],
      pattern: '^xoxc-.+$',
    },
    {
      id: 'cookie_token',
      required: true,
      sources: [{ type: 'cookie', name: 'd', cookie_domain: 'slack.com' }],
      pattern: '^xoxd-[a-zA-Z0-9/+=]+$',
    },
  ],
  extract_js: 'new Promise(() => {})',
};

function snapshot(overrides: Partial<WebSnapshot> = {}): WebSnapshot {
  return {
    url: 'https://app.slack.com/client',
    cookies: [],
    extracted: null,
    localStorage: {},
    ...overrides,
  };
}

describe('web sign-in fields', () => {
  it('takes cookies by name and domain, and special values from extract_js', () => {
    const seen = snapshot({
      cookies: [
        { name: 'd', value: 'xoxd-abc/123=', domain: '.slack.com' },
        { name: 'd', value: 'other', domain: 'example.com' },
      ],
      extracted: { 'fi.mau.slack.auth_token': 'xoxc-1-2-3' },
    });
    const values = collectWebFields(SLACK_TOKEN, seen);
    expect(values).toEqual({ auth_token: 'xoxc-1-2-3', cookie_token: 'xoxd-abc/123=' });
    expect(webFieldsComplete(SLACK_TOKEN, values)).toBe(true);
  });

  it('falls back to the field id in extract_js results and checks the pattern', () => {
    const params: CookiesParams = {
      url: 'https://slack.com/signin',
      fields: [{ id: 'captcha_token', required: true, sources: [{ type: 'special', name: 'x' }] }],
    };
    expect(collectWebFields(params, snapshot({ extracted: { captcha_token: 'solved' } }))).toEqual({
      captcha_token: 'solved',
    });
    const values = collectWebFields(SLACK_TOKEN, snapshot({ extracted: { auth_token: 'nope' } }));
    expect(values).toEqual({});
    expect(webFieldsComplete(SLACK_TOKEN, values)).toBe(false);
  });

  it('waits for the URL pattern unless the user closed the window', () => {
    const params: CookiesParams = {
      url: 'https://www.instagram.com/',
      wait_for_url_pattern: '^https://www\\.instagram\\.com/$',
      fields: [
        { id: 'sessionid', required: true, sources: [{ type: 'cookie', name: 'sessionid' }] },
      ],
    };
    const cookies = [{ name: 'sessionid', value: 's', domain: '.instagram.com' }];
    const midway = snapshot({ url: 'https://www.instagram.com/challenge/', cookies });
    expect(readyWebFields(params, midway)).toBeNull();
    expect(readyWebFields(params, midway, true)).toEqual({ sessionid: 's' });
    expect(readyWebFields(params, { ...midway, url: 'https://www.instagram.com/' })).toEqual({
      sessionid: 's',
    });
    expect(readyWebFields(params, snapshot({ url: 'https://www.instagram.com/' }))).toBeNull();
  });

  it('lists the hosts and storage keys the window has to read', () => {
    const params: CookiesParams = {
      url: 'https://www.messenger.com/?no_redirect=true',
      fields: [
        {
          id: 'xs',
          required: true,
          sources: [{ type: 'cookie', name: 'xs', cookie_domain: 'messenger.com' }],
        },
        { id: 'k', required: false, sources: [{ type: 'local_storage', name: 'token' }] },
      ],
    };
    expect(webDomains(params)).toEqual(['www.messenger.com', 'messenger.com']);
    expect(localStorageKeys(params)).toEqual(['token']);
    expect(collectWebFields(params, snapshot({ localStorage: { token: 't' } }))).toEqual({
      k: 't',
    });
  });
});

describe('bridge provisioning', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  async function connected() {
    const api = new FakeMatrix();
    const chat = await MatrixSession.connect({
      createApi: async () => api,
      parameters: { ...PARAMETERS, session: SESSION },
      persistSession: async () => {},
    });
    await flush();
    return chat;
  }

  function reply(status: number, body: unknown) {
    fetchMock.mockResolvedValueOnce({
      ok: status < 300,
      status,
      text: async () => JSON.stringify(body),
    });
  }

  it('calls the bridge on the homeserver with the user’s token', async () => {
    const provisioning = (await connected()).bridgeProvisioning('slack');
    const step: LoginStep = { login_id: 'l1', type: 'user_input', step_id: 'fi.mau.email' };
    reply(200, step);
    await expect(provisioning!.start('email')).resolves.toEqual(step);
    reply(200, { ...step, type: 'complete' });
    await provisioning!.submit(step, { email: 'a@b.c' });

    const [startUrl, startInit] = fetchMock.mock.calls[0];
    expect(startUrl).toBe(
      `${PARAMETERS.homeserverUrl}/_matrix/provision/slack/v3/login/start/email?user_id=${encodeURIComponent(SESSION.userId)}`
    );
    expect(startInit).toMatchObject({
      method: 'POST',
      headers: { Authorization: `Bearer ${SESSION.accessToken}` },
    });
    const [submitUrl, submitInit] = fetchMock.mock.calls[1];
    expect(submitUrl).toContain('/v3/login/step/l1/fi.mau.email/user_input?user_id=');
    expect(submitInit.body).toBe(JSON.stringify({ email: 'a@b.c' }));
  });

  it('reports the bridge’s error message', async () => {
    const provisioning = (await connected()).bridgeProvisioning('slack');
    reply(403, { errcode: 'M_FORBIDDEN', error: 'User does not have login permissions' });
    await expect(provisioning!.whoami()).rejects.toThrow('User does not have login permissions');
  });

  it('has nothing to offer before sign-in', async () => {
    const api = new FakeMatrix();
    const chat = await MatrixSession.connect({
      createApi: async () => api,
      parameters: { ...PARAMETERS, session: null },
      persistSession: async () => {},
    });
    await flush();
    expect(chat.bridgeProvisioning('slack')).toBeNull();
  });
});
