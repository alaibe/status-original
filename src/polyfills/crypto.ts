import 'react-native-get-random-values';

import * as ExpoCrypto from 'expo-crypto';

type RandomValuesFn = <T extends ArrayBufferView | null>(array: T) => T;

const target = globalThis as unknown as {
  crypto?: { getRandomValues?: RandomValuesFn };
};

if (typeof target.crypto !== 'object' || target.crypto === null) {
  target.crypto = {};
}

if (typeof target.crypto.getRandomValues !== 'function') {
  target.crypto.getRandomValues = ((array) =>
    array === null ? array : ExpoCrypto.getRandomValues(array as never)) as RandomValuesFn;
}
