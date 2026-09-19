'use client';

import { useMemo, useState } from 'react';

import { EMPTY_ENTRY, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import { arrivalEstimate, relativeMoment } from '@entole/core/format';
import { ESTIMATED_ARRIVAL_SECONDS, FEE_MINOR } from '@entole/core/gateway';
import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { Amount } from '@/components/Amount';
import { Avatar } from '@/components/Avatar';
import { Header } from '@/components/Header';
import { Keypad } from '@/components/Keypad';

/**
 * Paying a supplier is the same settlement as sending money to anyone — one
 * payment, one receipt — so this page calls the same `store.send()` the
 * personal send flow does. A supplier has to be someone already in your
 * contacts; there is no separate supplier record to invent.
 */
export default function PaySupplierPage() {
  const store = useStore();

  const [contactId, setContactId] = useState<string | null>(null);
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);

  const contact = contactId ? store.contact(contactId) : undefined;
  const amount = useMemo(() => entryToMinor(entry), [entry]);
  const enough = amount > 0 && amount + FEE_MINOR <= store.balance;
  const ready = Boolean(contact) && enough;
  const receipt = receiptId ? store.receipt(receiptId) : undefined;

  async function submit() {
    if (!contact || !ready || sending) return;
    setProblem(null);
    setSending(true);
    try {
      const settled = await store.send({ contactId: contact.id, amountMinor: amount, note: 'Supplier payment' });
      setReceiptId(settled.id);
    } catch {
      setProblem('That payment did not go through. Nothing left your balance.');
    } finally {
      setSending(false);
    }
  }

  function startOver() {
    setContactId(null);
    setEntry(EMPTY_ENTRY);
    setReceiptId(null);
    setProblem(null);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Pay a supplier" back="/business" />

      {receipt && contact ? (
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
            onClick={startOver}
            className="mt-8 flex h-14 items-center justify-center rounded-control bg-ink px-8 font-strong text-body-lg text-paper"
          >
            Done
          </button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col px-gutter-lg pt-2">
          <p className="font-heavy text-body-sm text-ink">Who are you paying?</p>
          <div className="mt-3 flex gap-2.5 overflow-x-auto pb-1">
            {store.contacts.map((entryContact) => {
              const selected = entryContact.id === contactId;
              return (
                <button
                  key={entryContact.id}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`Pay ${entryContact.name}`}
                  onClick={() => setContactId(entryContact.id)}
                  className={`flex flex-none items-center gap-2 rounded-pill border py-1.5 pl-1.5 pr-3.5 transition-colors ${
                    selected ? 'border-indigo bg-indigo-wash' : 'border-line bg-card hover:border-mist'
                  }`}
                >
                  <Avatar initials={entryContact.initials} tone={entryContact.tone} />
                  <span className="font-strong text-label-sm text-ink">{entryContact.name.split(' ')[0]}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex flex-col items-center">
            <Amount value={amount} size="large" />
            <p className="tabular mt-2.5 text-center font-body text-label-sm text-slate">
              {contact ? `To ${contact.name}` : 'Pick a supplier first'} · Fee {formatNaira(kobo(FEE_MINOR))} · arrives
              in {arrivalEstimate(ESTIMATED_ARRIVAL_SECONDS)}
            </p>
            {problem ? <p className="mt-4 text-center font-body text-label-sm text-halt">{problem}</p> : null}
            {amount > 0 && !enough ? (
              <p className="mt-4 text-center font-body text-label-sm text-caution">
                That is more than your balance covers, including the fee.
              </p>
            ) : null}
          </div>

          <div className="mt-auto w-full pb-28 pt-4">
            <Keypad onKey={(key) => setEntry((current) => pressKey(current, key))} />
            <button
              type="button"
              disabled={!ready || sending}
              onClick={() => void submit()}
              className="mt-3 flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep disabled:opacity-60"
            >
              {sending ? 'Sending' : amount > 0 ? `Pay ${formatNaira(amount)}` : 'Pay'}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
