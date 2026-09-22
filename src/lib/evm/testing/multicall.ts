import { decodeFunctionData, encodeAbiParameters, type Address, type Hex } from 'viem';

const AGGREGATE3 = [
  {
    name: 'aggregate3',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'allowFailure', type: 'bool' },
          { name: 'callData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      {
        name: 'returnData',
        type: 'tuple[]',
        components: [
          { name: 'success', type: 'bool' },
          { name: 'returnData', type: 'bytes' },
        ],
      },
    ],
  },
] as const;

/** Answers Multicall3 with `holds` for the addresses it names, zero for the rest. */
export function stubMulticall(holds: Record<string, bigint> = {}): string[] {
  const calls: string[] = [];

  global.fetch = jest.fn(async (_url, init) => {
    const body = JSON.parse(String((init as RequestInit).body));
    const requests = Array.isArray(body) ? body : [body];

    const answers = requests.map((request) => {
      const { args } = decodeFunctionData({
        abi: AGGREGATE3,
        data: request.params[0].data as Hex,
      });
      const asked = args[0] as readonly { target: Address }[];
      calls.push(request.method as string);

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: encodeAbiParameters(AGGREGATE3[0].outputs, [
          asked.map((call) => ({
            success: true,
            returnData: encodeAbiParameters(
              [{ type: 'uint256' }],
              [holds[call.target.toLowerCase()] ?? 0n]
            ),
          })),
        ]),
      };
    });

    const payload = Array.isArray(body) ? answers : answers[0];
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as Response;
  }) as unknown as typeof fetch;

  return calls;
}
