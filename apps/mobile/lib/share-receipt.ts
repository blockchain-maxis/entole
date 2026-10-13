import { Share } from 'react-native';

import { receiptFileName, receiptImageLink, receiptWords } from '@entole/core/receipt-slip';

import { CHECKOUT_BASE } from './onchain';

/**
 * Sharing a receipt from the phone. What is shared is a picture of the slip,
 * drawn by the server from the payment it kept: the picture is brought down
 * to the phone and handed to the share sheet as a file.
 *
 * Bringing a file down and sharing it take two native modules. A build
 * installed before they were added does not contain them, and importing them
 * there throws, so they are loaded inside a `try`. On such a build, or when
 * the picture cannot be had, the receipt goes as words with its link under
 * them: the link opens the same slip and shows as its picture in a chat.
 */
type Sharing = typeof import('expo-sharing');
type FileSystem = typeof import('expo-file-system');

function loadPictureModules(): { sharing: Sharing; files: FileSystem } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharing = require('expo-sharing') as Sharing;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const files = require('expo-file-system') as FileSystem;
    return { sharing, files };
  } catch {
    return null;
  }
}

const PNG = 'image/png';

/** How long to wait before asking for the picture once more. */
const SECOND_TRY_MS = 1200;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type ReceiptShared =
  /** The picture went to the share sheet. */
  | 'picture'
  /** The picture could not be had on a build that can share one; words and the link went instead. */
  | 'words-instead'
  /** This build cannot share a file; words and the link are what it shares. */
  | 'words'
  | 'failed';

/**
 * Shares one receipt. `tell` says to the server again which payment this is,
 * and resolves to whether the server has it: the server only draws a receipt
 * for a payment it has kept, and the first telling, when the payment settled,
 * was not waited for. `words` is the receipt as plain text, for when the
 * picture cannot go.
 */
export async function shareReceipt(input: {
  reference: string;
  words: string;
  tell: () => Promise<boolean>;
}): Promise<ReceiptShared> {
  let kept = await input.tell().catch(() => false);

  const modules = loadPictureModules();
  const address = receiptImageLink(CHECKOUT_BASE, input.reference);
  const able = modules && address ? await modules.sharing.isAvailableAsync().catch(() => false) : false;

  if (modules && address && able) {
    let picture: { uri: string } | null = null;
    for (let attempt = 0; attempt < 2 && !picture; attempt += 1) {
      if (attempt > 0) {
        // The server may have been reading the payment back from the network.
        await pause(SECOND_TRY_MS);
        kept = (await input.tell().catch(() => false)) || kept;
      }
      try {
        const into = new modules.files.File(modules.files.Paths.cache, receiptFileName(input.reference));
        picture = await modules.files.File.downloadFileAsync(address, into, { idempotent: true });
      } catch {
        // Not there yet, or no connection: once more, then words.
      }
    }
    if (picture) {
      try {
        await modules.sharing.shareAsync(picture.uri, { mimeType: PNG, UTI: 'public.png', dialogTitle: 'Share receipt' });
        return 'picture';
      } catch {
        // The share sheet would not take the file: words.
      }
    }
  }

  try {
    await Share.share({
      message: receiptWords({ words: input.words, base: CHECKOUT_BASE, reference: input.reference, kept }),
    });
    return able ? 'words-instead' : 'words';
  } catch {
    return 'failed';
  }
}
