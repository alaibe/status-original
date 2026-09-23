import type { ChatSession } from './protocol';

export type Capability = {
  [K in keyof ChatSession]-?: undefined extends ChatSession[K]
    ? NonNullable<ChatSession[K]> extends (...args: never[]) => unknown
      ? K
      : never
    : never;
}[keyof ChatSession];

export type CapabilityMethod<K extends Capability> = NonNullable<ChatSession[K]>;

export function supports(session: ChatSession | undefined, key: Capability): boolean {
  return typeof session?.[key] === 'function';
}

export function capability<K extends Capability>(
  session: ChatSession,
  key: K
): CapabilityMethod<K> {
  const method = session[key];
  if (typeof method !== 'function') throw new Error('This network does not support that.');
  return (method as (...args: unknown[]) => unknown).bind(session) as CapabilityMethod<K>;
}
