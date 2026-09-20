import * as LocalAuthentication from 'expo-local-authentication';

import { VaultKey, vaultDelete, vaultGet, vaultSet } from '@/storage/vault';

export interface BiometricCapability {
  available: boolean;
  enrolled: boolean;
  label: string;
}

export async function biometricCapability(): Promise<BiometricCapability> {
  if (process.env.EXPO_OS === 'web') {
    return { available: false, enrolled: false, label: 'Biometrics' };
  }

  const [available, enrolled, types] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);

  return { available, enrolled, label: describe(types) };
}

function describe(types: LocalAuthentication.AuthenticationType[]): string {
  const has = (t: LocalAuthentication.AuthenticationType) => types.includes(t);

  if (has(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    return process.env.EXPO_OS === 'ios' ? 'Face ID' : 'Face unlock';
  }
  if (has(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    return process.env.EXPO_OS === 'ios' ? 'Touch ID' : 'Fingerprint';
  }
  if (has(LocalAuthentication.AuthenticationType.IRIS)) return 'Iris';
  return 'Biometrics';
}

export async function authenticate(reason: string): Promise<boolean> {
  if (process.env.EXPO_OS === 'web') return true;

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Cancel',
    fallbackLabel: 'Use passcode',
  });
  return result.success;
}

export async function isLockEnabled(): Promise<boolean> {
  return (await vaultGet(VaultKey.biometricLock)) === '1';
}

export async function setLockEnabled(enabled: boolean, label = 'Biometrics'): Promise<boolean> {
  if (!enabled) {
    await vaultDelete(VaultKey.biometricLock);
    return true;
  }

  const passed = await authenticate(`Confirm ${label} to protect this app`);
  if (!passed) return false;

  await vaultSet(VaultKey.biometricLock, '1');
  return true;
}
