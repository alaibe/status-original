/** The path a native SDK wants from a `file://` URI the app holds. */
export function pathOfFileUri(uri: string): string {
  return decodeURI(uri.replace(/^file:\/\//, ''));
}
