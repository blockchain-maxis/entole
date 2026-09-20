/**
 * The bytes of a file the document picker copied into the app's cache. `fetch`
 * on a file URI gives an ArrayBuffer on current React Native; where that is not
 * there, the same response as a Blob is read with `FileReader`.
 */
export async function readFileBytes(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri);
  if (typeof response.arrayBuffer === 'function') {
    try {
      return new Uint8Array(await response.arrayBuffer());
    } catch {
      // Fall through to the Blob path below with a fresh response.
    }
  }
  const blob = await (await fetch(uri)).blob();
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsArrayBuffer(blob);
  });
}
