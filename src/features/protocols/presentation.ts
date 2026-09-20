import { LOCAL_PROTOCOL, type ProtocolId } from '@/core/messaging/namespace';
import type { ChatProtocolMeta } from '@/core/messaging/protocol';
import { protocolById } from '@/protocols';

export type ProtocolTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

export interface ProtocolBadge {
  label: string;
  tone: ProtocolTone;
}

const LOCAL_BADGE: ProtocolBadge = { label: 'On device', tone: 'neutral' };

export function protocolBadge(protocol: string | undefined): ProtocolBadge | null {
  if (!protocol) return null;
  if (protocol === LOCAL_PROTOCOL) return LOCAL_BADGE;

  const descriptor = protocolById(protocol);
  if (!descriptor) return { label: protocol, tone: 'neutral' };

  return { label: descriptor.label, tone: toneFor(descriptor.meta) };
}

export function toneFor(meta: ChatProtocolMeta): ProtocolTone {
  if (!meta.properties.endToEndEncrypted) return 'danger';
  if (meta.properties.groupModel === 'enforced' && meta.properties.forwardSecrecy) {
    return 'success';
  }
  return 'warning';
}

export function protocolSubtitle(protocol: string | undefined): string {
  if (!protocol || protocol === LOCAL_PROTOCOL) return 'On this device only';

  const descriptor = protocolById(protocol);
  if (!descriptor) return 'Unknown transport';

  const { properties } = descriptor.meta;
  if (!properties.endToEndEncrypted) return `${descriptor.label} · not end-to-end encrypted`;
  return `${descriptor.label} · end-to-end encrypted`;
}

export function describeProtocol(meta: ChatProtocolMeta): string {
  const { properties } = meta;
  const traits = [
    properties.endToEndEncrypted ? 'end-to-end encrypted' : 'NOT end-to-end encrypted',
    properties.forwardSecrecy ? 'forward secrecy' : 'no forward secrecy',
    `${properties.metadataPrivacy} metadata privacy`,
    GROUP_MODEL[properties.groupModel],
    properties.maxGroupSize === 'unbounded'
      ? 'unlimited group size'
      : `groups up to ${properties.maxGroupSize}`,
    properties.durableHistory ? 'history restores on a new device' : 'history stays on this device',
  ];
  return traits.join(' · ');
}

const GROUP_MODEL: Record<ChatProtocolMeta['properties']['groupModel'], string> = {
  enforced: 'enforced membership',
  'recipient-set': 'membership is just who you address',
  topic: 'anyone with the topic can join',
};

export function protocolLabel(protocol: ProtocolId | undefined): string {
  if (!protocol || protocol === LOCAL_PROTOCOL) return 'On device';
  return protocolById(protocol)?.label ?? protocol;
}
