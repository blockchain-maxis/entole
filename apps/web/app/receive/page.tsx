'use client';

import { useState } from 'react';

import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { Amount } from '@/components/Amount';
import { Header } from '@/components/Header';
import { Skeleton } from '@/components/Skeleton';

/**
 * The far end of the corridor. Whoever pays has no app, no account and no
 * reason to get one — so everything they need is in the link. (No QR code
 * library is wired into the web app yet — the phone app's `PaymentCode`
 * has no web port here; the link itself carries the same information.)
 */
export default function ReceivePage() {
  const store = useStore();
  const request = store.request;
  const [copied, setCopied] = useState(false);

  const link = request?.link ?? '';
  const url = `https://${link}`;

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  async function share() {
    const text = `${request?.requesterName} is asking for ${formatNaira(kobo(request?.amountMinor ?? 0))} — ${request?.note}. Pay here: ${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ text });
      } catch {
        // Cancelled — no error state needed.
      }
    } else {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Receive" />

      <div className="flex-1 px-gutter pb-28 pt-1">
        {request ? (
          <div className="flex flex-col items-center rounded-panel border border-line bg-card px-gutter py-6 shadow-raised">
            <p className="font-strong text-body-sm text-ink">{request.requesterName} is asking for</p>
            <div className="mt-2">
              <Amount value={kobo(request.amountMinor)} size="medium" />
            </div>
            <p className="mt-1.5 font-body text-label-sm text-slate">“For the {request.note.toLowerCase()}”</p>
            <p className="mt-5 font-strong text-caption text-mist">{link}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center rounded-card border border-line bg-card px-gutter py-6">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="mt-3 h-10 w-40" />
          </div>
        )}

        <div className="mt-3.5 rounded-row border border-line bg-card px-[18px] py-4">
          <p className="font-strong text-label text-ink">They don&apos;t need the app</p>
          <p className="mt-1.5 font-body text-label-sm text-slate">
            Anyone can open this link and pay you with their bank card or bank app. No account, no
            download, no sign-up.
          </p>
        </div>

        <div className="mt-4 flex gap-2.5">
          <button
            type="button"
            disabled={!request}
            onClick={() => void share()}
            className="flex h-14 flex-1 items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep disabled:opacity-60"
          >
            Share
          </button>
          <button
            type="button"
            disabled={!request}
            onClick={() => void copy()}
            className="flex h-14 items-center justify-center rounded-control border border-line bg-card px-5 font-strong text-body-lg text-ink disabled:opacity-60"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </main>
  );
}
