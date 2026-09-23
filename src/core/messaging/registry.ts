import type { LocalAccount } from 'viem';

import type { DerivedKey } from '../identity/keyring';
import {
  missingFields,
  withDefaults,
  type ProtocolConfig,
  type ProtocolConfigSchema,
} from './config';
import { PROTOCOL_ID, type ProtocolId } from './namespace';
import type { ChatProtocolMeta, ChatSession, CustomContentType } from './protocol';
import type { AccountStorage } from '@/storage/account';

export interface ProtocolConnectParams {
  accountId: string;
  account: LocalAccount;
  derive(path: string): DerivedKey;
  contentTypes: CustomContentType[];
  config: ProtocolConfig;
  storage: AccountStorage;
}

export interface ProtocolEraseParams {
  accountId: string;
  address: `0x${string}`;
  config: ProtocolConfig;
}

/** How the new-chat screen asks for, and fails to find, someone on this network. */
export interface RecipientCopy {
  label: string;
  placeholder: string;
  /** With its article, for prose: "Paste an address below". */
  noun: string;
  hint: string;
  unreachable(input: string): string;
}

export interface ProtocolDescriptor {
  id: ProtocolId;
  label: string;
  meta: ChatProtocolMeta;
  description: string;
  docsUrl?: string;
  /** An account on someone else's network, signed into, rather than one made from your keys. */
  external: boolean;
  recipient: RecipientCopy;
  configSchema: ProtocolConfigSchema;
  connect?(params: ProtocolConnectParams): Promise<ChatSession>;
  eraseLocalData?(params: ProtocolEraseParams): Promise<void>;
}

export function validateProtocols(protocols: readonly ProtocolDescriptor[]): void {
  const ids = new Set<string>();
  for (const descriptor of protocols) {
    if (!PROTOCOL_ID.test(descriptor.id)) {
      throw new Error(
        `Protocol id "${descriptor.id}" must be lowercase alphanumeric with no hyphen`
      );
    }
    if (ids.has(descriptor.id)) throw new Error(`Duplicate protocol id "${descriptor.id}"`);
    ids.add(descriptor.id);
  }
}

export function findProtocol(
  protocols: readonly ProtocolDescriptor[],
  id: ProtocolId
): ProtocolDescriptor | undefined {
  return protocols.find((protocol) => protocol.id === id);
}

export function transportProtocols(protocols: readonly ProtocolDescriptor[]): ProtocolDescriptor[] {
  return protocols.filter((protocol) => protocol.connect);
}

export function isConfigured(descriptor: ProtocolDescriptor, config: ProtocolConfig): boolean {
  return Boolean(descriptor.connect) && missingFields(descriptor.configSchema, config).length === 0;
}

export function effectiveConfig(
  descriptor: ProtocolDescriptor,
  config: ProtocolConfig
): ProtocolConfig {
  return withDefaults(descriptor.configSchema, config);
}
