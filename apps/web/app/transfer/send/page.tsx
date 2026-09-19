'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';

import { EMPTY_ENTRY, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import { arrivalEstimate, relativeMoment } from '@entole/core/format';
import { toDollars } from '@entole/core/fx';
import { ESTIMATED_ARRIVAL_SECONDS, FEE_MINOR } from '@entole/core/gateway';
import { formatDollars, formatNaira, kobo } from '@entole/core/money';
import type { Contact } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

import { Amount } from '@/components/Amount';
import { Avatar } from '@/components/Avatar';
import { Header } from '@/components/Header';
import { Keypad } from '@/components/Keypad';
import { RowSkeleton } from '@/components/Skeleton';

type Step = 'pick' | 'amount' | 'receipt';

/** Everyone here is a person, not an address. `?contact=` jumps straight to the amount. */
function SendFlow() {
  const store = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const loading = store.status === 'loading';

  const preselectedId = params.get('contact');
  const preselected = preselectedId ? store.contact(preselectedId) : undefined;

  const [step, setStep] = useState<Step | null>(null);
  const [chosen, setChosen] = useState<Contact | null>(null);
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);

  const contact = chosen ?? preselected ?? null;
  const current: Step = step ?? (contact ? 'amount' : 'pick');

  const amount = useMemo(() => entryToMinor(entry), [entry]);
  const enough = amount > 0 && amount + FEE_MINOR <= store.balance;
  const receipt = receiptId ? store.receipt(receiptId) : undefined;

  function pick(next: Contact) {
    setChosen(next);
    setEntry(EMPTY_ENTRY);
    setProblem(null);
    setStep('amount');
  }

  async function submit() {
    if (!contact || !enough || sending) return;
    setProblem(null);
    setSending(true);
    try {
      const settled = await store.send({ contactId: contact.id, amountMinor: amount });
      setReceiptId(settled.id);
      setStep('receipt');
    } catch {
      setProblem('That payment did not go through. Nothing left your balance.');
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Send money" back="/transfer" />

      {current === 'pick' ? (
        <div className="flex-1 px-gutter pb-28">
          <p className="pb-3 pt-[10px] font-strong text-body-lg text-ink">Who are you paying?</p>
          {loading ? (
            <div className="flex flex-col gap-2">
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {store.contacts.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => pick(entry)}
                    className="flex w-full items-center gap-3 rounded-row border border-line bg-card px-3.5 py-3 text-left transition-colors hover:border-mist"
                  >
                    <Avatar initials={entry.initials} tone={entry.tone} />
                    <div className="min-w-0 flex-1">
                      <p className="font-strong text-body text-ink">{entry.name}</p>
                      {entry.place ? <p className="font-body text-caption text-slate">{entry.place}</p> : null}
                    </div>
                    <span className="font-strong text-caption-sm text-indigo">Send</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {current === 'amount' && contact ? (
        <div className="flex flex-1 flex-col items-center px-gutter-lg pt-3">
          <div className="flex flex-1 flex-col items-center">
            <Avatar initials={contact.initials} tone={contact.tone} />
            <p className="mt-3 font-strong text-headline text-ink">{contact.name}</p>
            {contact.place ? <p className="mt-1 font-body text-label-sm text-slate">{contact.place}</p> : null}

            <div className="mt-7">
              <Amount value={amount} size="large" />
            </div>
            <p className="tabular mt-2.5 font-body text-body-sm text-slate">
              {amount > 0
                ? `${contact.name.split(' ')[0]} receives ${formatDollars(toDollars(amount, store.rate))}`
                : 'Enter an amount'}
            </p>

            <div className="mt-5 rounded-pill border border-line bg-card px-4 py-2.5">
              <p className="tabular font-body text-label-sm text-slate">
                Fee {formatNaira(kobo(FEE_MINOR))} · arrives in {arrivalEstimate(ESTIMATED_ARRIVAL_SECONDS)}
              </p>
            </div>

            {problem ? <p className="mt-4 text-center font-body text-label-sm text-halt">{problem}</p> : null}
            {amount > 0 && !enough ? (
              <p className="mt-4 text-center font-body text-label-sm text-caution">
                That is more than your balance covers, including the fee.
              </p>
            ) : null}
          </div>

          <div className="w-full pb-28">
            <Keypad onKey={(key) => setEntry((prev) => pressKey(prev, key))} />
            <div className="mt-3 flex gap-2.5">
              <button
                type="button"
                onClick={() => setStep('pick')}
                className="flex h-14 items-center justify-center rounded-control border border-line bg-card px-5 font-strong text-body-lg text-ink"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!enough || sending}
                onClick={() => void submit()}
                className="flex h-14 flex-1 items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep disabled:opacity-60"
              >
                {sending ? 'Sending' : amount > 0 ? `Send ${formatNaira(amount)}` : 'Send'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {current === 'receipt' && receipt && contact ? (
        <div className="flex flex-1 flex-col items-center justify-center px-gutter-lg pb-28 text-center">
          <span className="rounded-chip bg-settled-wash px-2.5 py-1 font-heavy text-caption-sm uppercase text-settled">
            Settled
          </span>
          <div className="mt-4">
            <Amount value={kobo(receipt.amountMinor)} size="large" />
          </div>
          <p className="mt-2 font-body text-body-sm text-slate">to {contact.name}</p>
          <p className="tabular mt-1 font-body text-caption text-mist">
            {receipt.reference} · {relativeMoment(receipt.settledAt)}
          </p>
          <button
            type="button"
            onClick={() => router.push('/transfer')}
            className="mt-8 flex h-14 items-center justify-center rounded-control bg-ink px-8 font-strong text-body-lg text-paper"
          >
            Done
          </button>
        </div>
      ) : null}
    </main>
  );
}

export default function SendPage() {
  return (
    <Suspense fallback={null}>
      <SendFlow />
    </Suspense>
  );
}
