import { accountProtocolConfigsKey, accountScopedKeys, vaultGet, vaultSet } from '@/storage/vault';
import {
  configLines,
  loadProtocolConfig,
  missingFields,
  saveProtocolConfig,
  withDefaults,
  type ProtocolConfigSchema,
} from './config';
import { effectiveConfig, isConfigured } from './registry';
import { protocolById } from '@/protocols';

const SCHEMA: ProtocolConfigSchema = {
  fields: [
    { key: 'nodeUrl', label: 'Node', kind: 'text', required: true },
    { key: 'relays', label: 'Relays', kind: 'lines', default: 'wss://a\nwss://b' },
    { key: 'secret', label: 'Secret', kind: 'secret' },
  ],
};

describe('storage', () => {
  it('round-trips per account, so two identities do not share credentials', async () => {
    await saveProtocolConfig('acct-a', 'waku', { nodeUrl: 'http://a' });
    await saveProtocolConfig('acct-b', 'waku', { nodeUrl: 'http://b' });

    expect(await loadProtocolConfig('acct-a', 'waku')).toEqual({ nodeUrl: 'http://a' });
    expect(await loadProtocolConfig('acct-b', 'waku')).toEqual({ nodeUrl: 'http://b' });
  });

  it('lives in the keychain, not AsyncStorage, because these are real credentials', async () => {
    await saveProtocolConfig('acct-a', 'waku', { nodeUrl: 'secret-value' });
    expect(await vaultGet(accountProtocolConfigsKey('acct-a'))).toContain('secret-value');
  });

  it('uses one account key, so wiping does not need to know protocol ids', () => {
    const keys = accountScopedKeys('acct-a');
    expect(keys).toContain(accountProtocolConfigsKey('acct-a'));
  });

  it('drops blank values instead of storing them', async () => {
    await saveProtocolConfig('acct-a', 'waku', { nodeUrl: '  ', pubsubTopic: '/x' });
    expect(await loadProtocolConfig('acct-a', 'waku')).toEqual({ pubsubTopic: '/x' });
  });

  it('deletes the entry when everything is cleared', async () => {
    await saveProtocolConfig('acct-a', 'waku', { nodeUrl: 'http://x' });
    await saveProtocolConfig('acct-a', 'waku', { nodeUrl: '' });
    expect(await loadProtocolConfig('acct-a', 'waku')).toEqual({});
  });

  it('returns an empty config rather than throwing on corrupt data', async () => {
    // A settings screen the user can fix beats a launch that crashes.
    await vaultSet(accountProtocolConfigsKey('acct-a'), 'not json');
    expect(await loadProtocolConfig('acct-a', 'nostr')).toEqual({});
  });
});

describe('defaults and validation', () => {
  it('fills unset fields but never overwrites a typed value', () => {
    expect(withDefaults(SCHEMA, {})).toEqual({ relays: 'wss://a\nwss://b' });
    expect(withDefaults(SCHEMA, { relays: 'wss://mine' }).relays).toBe('wss://mine');
  });

  it('reports missing required fields', () => {
    expect(missingFields(SCHEMA, {}).map((f) => f.key)).toEqual(['nodeUrl']);
    expect(missingFields(SCHEMA, { nodeUrl: 'http://x' })).toEqual([]);
  });

  it('splits a lines field, ignoring blanks and comments', () => {
    expect(configLines('wss://a\n\n# a note\nwss://b , wss://c ')).toEqual([
      'wss://a',
      'wss://b',
      'wss://c',
    ]);
    expect(configLines(undefined)).toEqual([]);
  });
});

describe('the registry', () => {
  it('ships public relay defaults for Nostr, which are infrastructure not secrets', () => {
    const nostr = protocolById('nostr')!;
    const relays = configLines(effectiveConfig(nostr, {}).relays);
    expect(relays.length).toBeGreaterThan(0);
    expect(relays.every((r) => r.startsWith('wss://'))).toBe(true);
    expect(isConfigured(nostr, effectiveConfig(nostr, {}))).toBe(true);
  });

  it('ships no Waku node, so Waku sits idle until the user supplies one', () => {
    const waku = protocolById('waku')!;
    expect(effectiveConfig(waku, {}).nodeUrl).toBeUndefined();
    expect(isConfigured(waku, effectiveConfig(waku, {}))).toBe(false);
    expect(isConfigured(waku, { nodeUrl: 'http://127.0.0.1:8645' })).toBe(true);
  });

  it('distinguishes the three group models honestly', () => {
    expect(protocolById('xmtp')!.meta.properties.groupModel).toBe('enforced');
    expect(protocolById('nostr')!.meta.properties.groupModel).toBe('recipient-set');
    expect(protocolById('waku')!.meta.properties.groupModel).toBe('topic');
  });
});
