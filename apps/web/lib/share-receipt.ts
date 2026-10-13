import { receiptFileName, receiptImagePath, receiptLink } from '@entole/core/receipt-slip';

/**
 * Sharing a receipt from the browser. What is shared is a picture of the slip,
 * drawn by the server from the payment it kept (`/api/receipt/<reference>/image`).
 * In order of preference:
 *
 *   1. the picture, handed to the phone's own share panel as a file;
 *   2. the picture, saved to the device, where the browser cannot share files;
 *   3. the receipt's link, where the picture cannot be had at all. The link
 *      opens the same slip and shows as its picture in a chat.
 *
 * Nothing here draws anything or knows an amount: it fetches the picture the
 * server drew, or it passes on a link.
 */

const PNG = 'image/png';

/** How long to wait before asking for the picture once more. */
const SECOND_TRY_MS = 1200;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function fetchPicture(reference: string): Promise<File | null> {
  const path = receiptImagePath(reference);
  if (!path) return null;
  try {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok || !response.headers.get('content-type')?.startsWith(PNG)) return null;
    const picture = await response.blob();
    return picture.size > 0 ? new File([picture], receiptFileName(reference), { type: PNG }) : null;
  } catch {
    return null;
  }
}

/**
 * The receipt's picture as a file, or `null` when it cannot be had.
 *
 * The server only draws a receipt for a payment it has kept, and it keeps one
 * when the sender's app tells it the payment settled. That telling is not
 * waited for when the payment is made, so it is said again here first
 * (`tell`), and waited for. If the picture still is not there, both are tried
 * once more after a moment: the server may have been reading the payment back
 * from the network.
 */
export async function prepareReceiptPicture(reference: string, tell: () => Promise<boolean>): Promise<File | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await pause(SECOND_TRY_MS);
    await tell().catch(() => false);
    const picture = await fetchPicture(reference);
    if (picture) return picture;
  }
  return null;
}

/** Whether this browser can hand a picture to the share panel. */
export function canSharePicture(picture: File): boolean {
  try {
    return typeof navigator.share === 'function' && navigator.canShare?.({ files: [picture] }) === true;
  } catch {
    return false;
  }
}

export type Shared = 'shared' | 'dismissed' | 'refused';

/**
 * Hands the picture to the share panel. `dismissed` is the person closing the
 * panel, which is not a failure. `refused` is the browser declining to open
 * it: it only will straight after a press, and getting the picture ready can
 * outlast that.
 */
export async function sharePicture(picture: File): Promise<Shared> {
  try {
    await navigator.share({ files: [picture], title: 'Entole receipt' });
    return 'shared';
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError' ? 'dismissed' : 'refused';
  }
}

/** Saves the picture to the device, the way any download is saved. */
export function savePicture(picture: File): void {
  const url = URL.createObjectURL(picture);
  const link = document.createElement('a');
  link.href = url;
  link.download = picture.name;
  document.body.append(link);
  link.click();
  link.remove();
  // Let the browser start on it before the address is given back.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type LinkShared = 'shared' | 'dismissed' | 'copied' | 'failed';

/** The last resort: the receipt's link, through the share panel or else copied. */
export async function shareReceiptLink(reference: string): Promise<LinkShared> {
  const url = receiptLink(window.location.origin, reference);
  if (!url) return 'failed';
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ url, title: 'Entole receipt' });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'dismissed';
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
