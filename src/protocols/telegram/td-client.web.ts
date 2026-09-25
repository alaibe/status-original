import { invoke } from '@tauri-apps/api/core';

import type { TdObject } from './api';
import { TdJsonClient, type TdDriver } from './json-client';

// How long one receive may block in Rust; closing the client waits for it.
const RECEIVE_TIMEOUT_S = 1;
const RECEIVE_LIMIT = 500;

const driver: TdDriver = {
  create: () => invoke('td_create'),
  send: (request) => invoke('td_send', { request: JSON.stringify(request) }),
  receive: () =>
    invoke<TdObject[]>('td_receive', { timeout: RECEIVE_TIMEOUT_S, limit: RECEIVE_LIMIT }),
  destroy: () => invoke('td_destroy'),
};

export const TdClient = {
  create: () => TdJsonClient.create(driver),
};
