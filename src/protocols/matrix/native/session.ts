import * as sdk from '@unomed/react-native-matrix-sdk';

import type { MxPreview, MxSession } from '../api';
import { mapContent, nameOf } from './map';

export function timelineConfiguration(): sdk.TimelineConfiguration {
  return {
    focus: new sdk.TimelineFocus.Live({ hideThreadedEvents: false }),
    filter: new sdk.TimelineFilter.All(),
    dateDividerMode: sdk.DateDividerMode.Daily,
    // The app shows no receipts, and tracking them re-emits every message whenever one moves.
    trackReadReceipts: sdk.TimelineReadReceiptTracking.Disabled,
    reportUtds: false,
  };
}

export async function latestOf(room: sdk.RoomLike): Promise<MxPreview | undefined> {
  const value = await room.latestEvent();
  if (
    value.tag !== sdk.LatestEventValue_Tags.Remote &&
    value.tag !== sdk.LatestEventValue_Tags.Local
  )
    return undefined;
  const content = mapContent(value.inner.content);
  if (!content) return undefined;
  return {
    sender: value.inner.sender,
    senderName: nameOf(value.inner.profile),
    timestamp: Number(value.inner.timestamp),
    isOwn: value.tag === sdk.LatestEventValue_Tags.Local || value.inner.isOwn,
    content,
  };
}

export function toSdkSession(session: MxSession): sdk.Session {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    userId: session.userId,
    deviceId: session.deviceId,
    homeserverUrl: session.homeserverUrl,
    oauthData: undefined,
    slidingSyncVersion: sdk.SlidingSyncVersion.Native,
  };
}

export function fromSdkSession(session: sdk.Session): MxSession {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    userId: session.userId,
    deviceId: session.deviceId,
    homeserverUrl: session.homeserverUrl,
  };
}
