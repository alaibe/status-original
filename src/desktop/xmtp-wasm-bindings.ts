/**
 * What `@xmtp/browser-sdk` gets when it imports `@xmtp/wasm-bindings` on web.
 *
 * The bindings locate their binary with `new URL('bindings_wasm_bg.wasm',
 * import.meta.url)`, and Metro has no `import.meta.url` inside a Web Worker.
 * The binary ships as a static file instead, and only the default export
 * changes: it passes that location through when the SDK calls it bare.
 */
import init from '@xmtp/wasm-bindings';

export * from '@xmtp/wasm-bindings';

const WASM_PATH = '/xmtp/bindings_wasm_bg.wasm';

export default function initFromStaticFile(
  moduleOrPath?: Parameters<typeof init>[0]
): ReturnType<typeof init> {
  return init(moduleOrPath ?? { module_or_path: new URL(WASM_PATH, self.location.href) });
}
