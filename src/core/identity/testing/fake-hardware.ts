import { concatHex, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';

import type { HardwareSigner } from '../hardware';

export class FakeHardwareSigner implements HardwareSigner {
  readonly id = 'fake';
  readonly label = 'Test device';

  refuse = false;
  readonly calls: string[] = [];

  constructor(private readonly privateKey: Hex) {}

  private account() {
    return privateKeyToAccount(this.privateKey);
  }

  async getAddress(path: string): Promise<Address> {
    this.calls.push(`getAddress:${path}`);
    return this.account().address;
  }

  async signMessage(path: string, message: string): Promise<Hex> {
    this.calls.push(`signMessage:${path}`);
    this.guard();
    return this.account().signMessage({ message });
  }

  async signTypedDataHashes(path: string, domainHash: Hex, messageHash: Hex): Promise<Hex> {
    this.calls.push(`signTypedDataHashes:${path}`);
    this.guard();
    return this.account().sign({ hash: keccak256(concatHex(['0x1901', domainHash, messageHash])) });
  }

  async signTransaction(path: string, serialized: Hex): Promise<Hex> {
    this.calls.push(`signTransaction:${path}`);
    this.guard();
    return this.account().sign({ hash: keccak256(serialized) });
  }

  private guard(): void {
    if (this.refuse) throw new Error('Rejected on device');
  }
}
