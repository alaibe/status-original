import { clearEnsProfileCache, resolveEnsProfile, resolveEnsProfiles } from './ens-profile';
import { lookupName } from './ens';
import { publicClientFor } from './chains';

jest.mock('./ens', () => ({ lookupName: jest.fn() }));
jest.mock('./chains', () => ({ publicClientFor: jest.fn() }));

const mockLookup = lookupName as jest.MockedFunction<typeof lookupName>;
const mockClientFor = publicClientFor as jest.MockedFunction<typeof publicClientFor>;

const ADDRESS = '0x1111111111111111111111111111111111111111' as const;
const OTHER = '0x2222222222222222222222222222222222222222' as const;

function client(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    // Expiry lives on the registrar, so it is a contract read rather than a
    // resolver call.
    readContract: jest.fn(async () => 1893456000n), // 2030-01-01
    getEnsAvatar: jest.fn(async () => 'https://example.com/a.png'),
    getEnsText: jest.fn(async ({ key }: { key: string }) =>
      key === 'description' ? 'builder' : 'https://example.com'
    ),
    ...overrides,
  };
}

beforeEach(() => {
  clearEnsProfileCache();
  jest.clearAllMocks();
  mockClientFor.mockReturnValue(client() as never);
});

describe('resolveEnsProfile', () => {
  it('returns the name, avatar and text records', async () => {
    mockLookup.mockResolvedValue('alice.eth');

    expect(await resolveEnsProfile(ADDRESS)).toEqual({
      name: 'alice.eth',
      avatar: 'https://example.com/a.png',
      description: 'builder',
      url: 'https://example.com',
      paidUntil: new Date(1893456000 * 1000),
    });
  });

  it('returns null when the address has no primary name', async () => {
    mockLookup.mockResolvedValue(null);
    expect(await resolveEnsProfile(ADDRESS)).toBeNull();
  });

  it('never asks for records when there is no name', async () => {
    // Avatar and text records hang off the name; asking anyway would be a
    // wasted mainnet round trip on the overwhelmingly common case.
    mockLookup.mockResolvedValue(null);
    const c = client();
    mockClientFor.mockReturnValue(c as never);

    await resolveEnsProfile(ADDRESS);

    expect(c.getEnsAvatar).not.toHaveBeenCalled();
    expect(c.getEnsText).not.toHaveBeenCalled();
  });

  it('caches the miss, which is the common case', async () => {
    mockLookup.mockResolvedValue(null);

    await resolveEnsProfile(ADDRESS);
    await resolveEnsProfile(ADDRESS);

    expect(mockLookup).toHaveBeenCalledTimes(1);
  });

  it('keeps the name when a record lookup fails', async () => {
    mockLookup.mockResolvedValue('alice.eth');
    mockClientFor.mockReturnValue(
      client({
        getEnsAvatar: jest.fn(async () => {
          throw new Error('gateway down');
        }),
      }) as never
    );

    const profile = await resolveEnsProfile(ADDRESS);

    expect(profile?.name).toBe('alice.eth');
    expect(profile?.avatar).toBeNull();
  });

  it('does not cache a resolver outage', async () => {
    // Caching it would make a transient failure look permanent for the whole
    // lifetime of the process.
    mockLookup.mockRejectedValueOnce(new Error('rpc down'));
    expect(await resolveEnsProfile(ADDRESS)).toBeNull();

    mockLookup.mockResolvedValue('alice.eth');
    expect((await resolveEnsProfile(ADDRESS))?.name).toBe('alice.eth');
  });

  it('is case-insensitive about the address', async () => {
    mockLookup.mockResolvedValue('alice.eth');

    await resolveEnsProfile(ADDRESS);
    await resolveEnsProfile(ADDRESS.toUpperCase() as typeof ADDRESS);

    expect(mockLookup).toHaveBeenCalledTimes(1);
  });
});

describe('resolveEnsProfiles', () => {
  it('resolves several and omits the ones without names', async () => {
    mockLookup.mockImplementation(async (address) =>
      address.toLowerCase() === ADDRESS ? 'alice.eth' : null
    );

    const out = await resolveEnsProfiles([ADDRESS, OTHER]);

    expect(Object.keys(out)).toEqual([ADDRESS]);
    expect(out[ADDRESS].name).toBe('alice.eth');
  });

  it('deduplicates before hitting the network', async () => {
    mockLookup.mockResolvedValue('alice.eth');

    await resolveEnsProfiles([ADDRESS, ADDRESS, ADDRESS]);

    expect(mockLookup).toHaveBeenCalledTimes(1);
  });
});

describe('onchain proof', () => {
  it('reports when the name is paid up to', async () => {
    // The point of showing this rather than a tick: an impersonator would have
    // to actually buy and renew the name to reproduce it.
    mockLookup.mockResolvedValue('alice.eth');
    const profile = await resolveEnsProfile(ADDRESS);

    expect(profile?.paidUntil?.getFullYear()).toBe(2030);
  });

  it('leaves it unset for a name the registrar does not own', async () => {
    // Subnames and other TLDs are not `.eth` second-level registrations.
    mockLookup.mockResolvedValue('team.alice.eth');
    const profile = await resolveEnsProfile(ADDRESS);

    expect(profile?.name).toBe('team.alice.eth');
    expect(profile?.paidUntil).toBeNull();
  });
});
