import { publicClientFor } from './chains';
import { CoinType, resolveName, resolveNameForCoin } from './ens';

jest.mock('./chains', () => ({ publicClientFor: jest.fn() }));

const mockClientFor = publicClientFor as jest.MockedFunction<typeof publicClientFor>;
const mockGetEnsAddress = jest.fn();
const ADDRESS = '0x1111111111111111111111111111111111111111';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetEnsAddress.mockReset();
  mockClientFor.mockReturnValue({ getEnsAddress: mockGetEnsAddress } as never);
});

describe.each([
  { record: 'Ethereum', resolve: resolveName },
  { record: 'Bitcoin', resolve: (name: string) => resolveNameForCoin(name, CoinType.bitcoin) },
])('$record ENS resolution', ({ resolve }) => {
  it('propagates a transient failure and allows the next lookup to recover', async () => {
    const outage = new Error('RPC unavailable');
    mockGetEnsAddress.mockRejectedValueOnce(outage).mockResolvedValueOnce(ADDRESS);

    await expect(resolve('transient-failure.eth')).rejects.toBe(outage);
    await expect(resolve('transient-failure.eth')).resolves.toBe(ADDRESS);
    await expect(resolve('transient-failure.eth')).resolves.toBe(ADDRESS);
    expect(mockGetEnsAddress).toHaveBeenCalledTimes(2);
  });

  it('caches a completed missing record rather than repeating the lookup', async () => {
    mockGetEnsAddress.mockResolvedValueOnce(null);

    await expect(resolve('missing-record.eth')).resolves.toBeNull();
    await expect(resolve('missing-record.eth')).resolves.toBeNull();
    expect(mockGetEnsAddress).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed names without making a network request', async () => {
    await expect(resolve('bad..eth')).resolves.toBeNull();
    await expect(resolve('0x00')).resolves.toBeNull();
    expect(mockClientFor).not.toHaveBeenCalled();
  });
});
