import type { ImagePickerAsset } from 'expo-image-picker';

/** The phone's picker re-encodes at the requested quality itself. */
export async function compressPickedImage(asset: ImagePickerAsset): Promise<ImagePickerAsset> {
  return asset;
}
