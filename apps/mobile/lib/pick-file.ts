import { readFileBytes } from './read-file';

type PickedFile = { uri: string; name: string; size?: number | null };
type Picker = {
  getDocumentAsync(options: { type: string | string[]; copyToCacheDirectory: boolean; multiple: boolean }): Promise<{
    canceled: boolean;
    assets?: PickedFile[] | null;
  }>;
};

/**
 * The document picker is a native module. A build made before it was added does
 * not contain it, and importing it there throws — so it is loaded inside a
 * `try`, and its absence is a message, not a crash. The same guard as the
 * payroll import.
 */
function loadPicker(): Picker | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-document-picker') as Picker;
  } catch {
    return null;
  }
}

export type PickedPdf = { name: string; bytes: Uint8Array };

/**
 * Asks the person for one PDF and reads its bytes. `null` when they cancelled;
 * `'unavailable'` when this build has no picker.
 */
export async function pickPdf(): Promise<PickedPdf | null | 'unavailable'> {
  const picker = loadPicker();
  if (!picker) return 'unavailable';
  const picked = await picker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false });
  const file = picked.canceled ? null : picked.assets?.[0];
  if (!file) return null;
  return { name: file.name, bytes: await readFileBytes(file.uri) };
}
