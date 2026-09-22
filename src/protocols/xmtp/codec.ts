import type { ContentTypeId, EncodedContent, JSContentCodec } from '@xmtp/react-native-sdk';

export const PLUGIN_AUTHORITY = 'status-original.plugin';

export interface PluginContentType<T> {
  typeId: string;
  versionMajor?: number;
  versionMinor?: number;
  fallback: (content: T) => string;
}

export function contentTypeIdFor(typeId: string, major = 1, minor = 0): ContentTypeId {
  return {
    authorityId: PLUGIN_AUTHORITY,
    typeId,
    versionMajor: major,
    versionMinor: minor,
  };
}

export function createPluginCodec<T>(spec: PluginContentType<T>): JSContentCodec<T> {
  const contentType = contentTypeIdFor(spec.typeId, spec.versionMajor ?? 1, spec.versionMinor ?? 0);

  return {
    contentType,

    encode(content: T): EncodedContent {
      return {
        type: contentType,
        parameters: { encoding: 'UTF-8' },
        content: new TextEncoder().encode(JSON.stringify(content)),
      };
    },

    decode(encoded: EncodedContent): T {
      const text = new TextDecoder().decode(
        encoded.content instanceof Uint8Array ? encoded.content : new Uint8Array(encoded.content)
      );
      return JSON.parse(text) as T;
    },

    fallback(content: T) {
      return spec.fallback(content);
    },

    shouldPush() {
      return true;
    },
  };
}
