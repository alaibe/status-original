import * as SecureStore from 'expo-secure-store';

const PROTECTED_SERVICE = 'com.statusoriginal.protected';

export const isSecureStorageAvailable = true;

function protectedOptions(prompt: string): SecureStore.SecureStoreOptions {
  return {
    keychainService: PROTECTED_SERVICE,
    requireAuthentication: true,
    authenticationPrompt: prompt,
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
}

export function get(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function set(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function remove(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}

/** Rejects when the user fails or refuses the biometric prompt. */
export function getProtected(key: string, prompt: string): Promise<string | null> {
  return SecureStore.getItemAsync(key, protectedOptions(prompt));
}

export async function setProtected(key: string, value: string, prompt: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, protectedOptions(prompt));
}

export async function removeProtected(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key, { keychainService: PROTECTED_SERVICE });
}
