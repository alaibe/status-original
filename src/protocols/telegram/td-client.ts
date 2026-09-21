import TdLib from 'react-native-tdlib';

import { TdJsonClient, type TdDriver } from './json-client';

const driver: TdDriver = {
  async create() {
    await TdLib.td_json_client_create();
  },
  async send(request) {
    await TdLib.td_json_client_send(request);
  },
  async receive() {
    try {
      return await TdLib.td_json_client_receive();
    } catch (error) {
      // The native call rejects on its own timeout when TDLib is idle.
      if (isNativeCode(error, 'RECEIVE_ERROR')) return null;
      throw error;
    }
  },
  async destroy() {
    await TdLib.td_json_client_destroy();
  },
};

export const TdClient = {
  create: () => TdJsonClient.create(driver),
};

function isNativeCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}
