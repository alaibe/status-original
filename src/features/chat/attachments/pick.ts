import { getDocumentAsync } from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import { INLINE_LIMIT_BYTES } from '@/core/messaging/attachments';
import type { MessageContent } from '@/core/messaging/types';

const PHOTO_QUALITY = 0.5;

export class AttachmentRejected extends Error {}

function assertFits(size: number | undefined, what: string): void {
  if (size !== undefined && size > INLINE_LIMIT_BYTES) {
    throw new AttachmentRejected(
      `${what} is ${Math.round(size / 1024)}KB. The limit is ` +
        `${Math.round(INLINE_LIMIT_BYTES / 1024)}KB, because attachments are sent ` +
        `inside the encrypted message rather than uploaded anywhere.`
    );
  }
}

function imageFrom(asset: ImagePicker.ImagePickerAsset): MessageContent {
  assertFits(asset.fileSize, 'That photo');
  return {
    kind: 'image',
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    size: asset.fileSize,
    name: asset.fileName ?? undefined,
    mimeType: asset.mimeType,
  };
}

export async function pickImage(): Promise<MessageContent | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new AttachmentRejected('Photo access is off for this app.');

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: PHOTO_QUALITY,
    exif: false,
  });
  if (result.canceled || !result.assets[0]) return null;
  return imageFrom(result.assets[0]);
}

export async function takePhoto(): Promise<MessageContent | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new AttachmentRejected('Camera access is off for this app.');

  const result = await ImagePicker.launchCameraAsync({
    quality: PHOTO_QUALITY,
    exif: false,
  });
  if (result.canceled || !result.assets[0]) return null;
  return imageFrom(result.assets[0]);
}

export async function pickFile(): Promise<MessageContent | null> {
  const result = await getDocumentAsync({ copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0];
  assertFits(asset.size, 'That file');

  return {
    kind: 'file',
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType,
    size: asset.size,
  };
}
