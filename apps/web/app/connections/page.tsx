'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { useBackend } from '@entole/core/backend';
import { useStore } from '@entole/core/store';

import { Header } from '@/components/Header';

/**
 * Connect a Telegram chat to this account, so a message like "send mom 5k for
 * rent" becomes a proposal that lands in the app and runs the same undo window
 * before anything settles. Linking shares the account's people and their
 * allowances with the assistant so it can match who a message means; it grants
 * no new spending power, and the assistant still cannot move money outside an
 * allowance you already set.
 */

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function makeCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export default function ConnectionsPage() {
  const store = useStore();
  const { inbox } = useBackend();
  const [code, setCode] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const activeAllowance =
    store.allowances.find((a) => !a.paused && a.remainingMinor > 0) ?? store.allowances[0];

  async function createCode() {
    setWorking(true);
    setProblem(null);
    setCopied(false);
    const next = makeCode();
    const registered = await inbox.registerLinkCode(next);
    if (!registered) {
      setProblem('Could not create a link code just now. Try again in a moment.');
      setWorking(false);
      return;
    }
    // Share the account's people and active allowance so the bot matches names
    // and charges a real allowance rather than reading an empty book.
    if (activeAllowance) await inbox.sync(store.contacts, activeAllowance.id);
    setCode(next);
    setWorking(false);
  }

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(`/link ${code}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Connections" back="/me" />

      <div className="flex-1 px-gutter pb-28 pt-2">
        <h2 className="font-strong text-headline text-ink">Ask the assistant by message</h2>
        <p className="mt-2.5 font-body text-body-sm text-slate">
          Connect Telegram and you can message the assistant to pay someone. Every
          request still appears here and waits out its undo window before it settles.
        </p>

        <ol className="mt-7 flex flex-col gap-5">
          <Step n={1} title="Create a link code" body="Get a one-time code for this account with the button below." />
          <Step n={2} title="Message the Entole bot" body="Open Telegram, find the Entole bot, and start a chat with it." />
          <Step n={3} title="Send the code" body="Send the bot the line below to tie that chat to your account." />
        </ol>

        {code ? (
          <div className="mt-7 flex flex-col gap-2 rounded-row border border-line bg-card p-4">
            <p className="font-body text-label-sm text-slate">Send this to the bot</p>
            <div className="flex items-center justify-between gap-3">
              <span className="tabular font-strong text-title text-ink">/link {code}</span>
              <button
                type="button"
                onClick={() => void copyCode()}
                className="flex h-10 items-center gap-1.5 rounded-control border border-line bg-card px-3 font-strong text-label-sm text-ink transition-colors hover:border-mist"
              >
                {copied ? <Check size={16} strokeWidth={1.75} /> : <Copy size={16} strokeWidth={1.75} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="mt-1 font-body text-label-sm text-mist">The code works once and expires after it is used.</p>
          </div>
        ) : null}

        {!activeAllowance ? (
          <p className="mt-6 font-body text-label-sm text-mist">
            Set up an allowance first, or the assistant will have nothing it is allowed to spend.
          </p>
        ) : null}
        {problem ? <p className="mt-4 font-body text-label-sm text-halt">{problem}</p> : null}

        <div className="mt-8">
          <button
            type="button"
            disabled={working || store.status === 'loading'}
            onClick={() => void createCode()}
            className="flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep disabled:opacity-60"
          >
            {working ? 'Creating' : code ? 'Create a new code' : 'Create a link code'}
          </button>
        </div>
      </div>
    </main>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex gap-3.5">
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-control bg-indigo-wash font-strong text-body text-indigo">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-strong text-body text-ink">{title}</p>
        <p className="mt-1 font-body text-body-sm text-slate">{body}</p>
      </div>
    </li>
  );
}