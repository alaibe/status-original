import { getDocumentAsync } from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import { INLINE_LIMIT_BYTES } from '@/core/messaging/attachments';

import { compressPickedImage } from './compress-image';
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
    width: asset.width || undefined,
    height: asset.height || undefined,
    size: asset.fileSize,
    name: asset.fileName ?? undefined,
    mimeType: asset.mimeType,
  };
}

async function imageFromBrowserFile(file: File): Promise<MessageContent> {
  const uri = URL.createObjectURL(file);
  let resultUri = uri;
  try {
    const asset = await compressPickedImage({
      uri,
      width: 0,
      height: 0,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
    });
    resultUri = asset.uri;
    const content = imageFrom(asset);
    if (resultUri !== uri) URL.revokeObjectURL(uri);
    return content;
  } catch (error) {
    URL.revokeObjectURL(uri);
    if (resultUri !== uri) URL.revokeObjectURL(resultUri);
    throw error;
  }
}

export async function contentFromBrowserFile(
  file: File,
  sendsVideo: boolean
): Promise<MessageContent> {
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml')
    return imageFromBrowserFile(file);
  const base = {
    uri: URL.createObjectURL(file),
    name: file.name,
    mimeType: file.type || undefined,
    size: file.size,
  };
  if (sendsVideo && file.type.startsWith('video/')) return { kind: 'video', ...base };
  assertFits(file.size, 'That file');
  return { kind: 'file', ...base };
}

async function fromLibrary(
  options: ImagePicker.ImagePickerOptions,
  denied: string
): Promise<ImagePicker.ImagePickerAsset | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new AttachmentRejected(denied);
  const result = await ImagePicker.launchImageLibraryAsync(options);
  return result.canceled ? null : (result.assets[0] ?? null);
}

export async function pickImage(): Promise<MessageContent | null> {
  const asset = await fromLibrary(
    { mediaTypes: ['images'], quality: PHOTO_QUALITY, exif: false },
    'Photo access is off for this app.'
  );
  return asset ? imageFrom(await compressPickedImage(asset)) : null;
}

export async function pickVideo(): Promise<MessageContent | null> {
  const asset = await fromLibrary({ mediaTypes: ['videos'] }, 'Video access is off for this app.');
  if (!asset) return null;
  return {
    kind: 'video',
    uri: asset.uri,
    width: asset.width || undefined,
    height: asset.height || undefined,
    durationMs: asset.duration ?? undefined,
    name: asset.fileName ?? undefined,
    mimeType: asset.mimeType,
    size: asset.fileSize,
  };
}

export async function takePhoto(): Promise<MessageContent | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new AttachmentRejected('Camera access is off for this app.');

  const result = await ImagePicker.launchCameraAsync({
    quality: PHOTO_QUALITY,
    exif: false,
  });
  if (result.canceled || !result.assets[0]) return null;
  return imageFrom(await compressPickedImage(result.assets[0]));
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
