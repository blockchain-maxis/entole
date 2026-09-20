'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { entryDisplay, entryToMinor, pressKey, type AmountEntry, EMPTY_ENTRY } from '@entole/core/amount-entry';
import { useBackend } from '@entole/core/backend';
import { buildCheckoutLink } from '@entole/core/checkout-link';
import { localDay, nextInvoiceReference } from '@entole/core/invoices';
import { useStore } from '@entole/core/store';

import { Header } from '@/components/Header';
import { Keypad } from '@/components/Keypad';
import { useAccount } from '@/lib/account';

const DUE_IN_DAYS = 14;

/** One-click generation, reusing the same settlement-link surface a
 * personal payment request already has. */
export default function NewInvoicePage() {
  const router = useRouter();
  const store = useStore();
  const { paymentCode } = useBackend();
  const { account } = useAccount();

  const [clientName, setClientName] = useState('');
  const [note, setNote] = useState('');
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [saving, setSaving] = useState(false);

  const amount = entryToMinor(entry);
  const ready = clientName.trim().length > 0 && note.trim().length > 0 && amount > 0;

  async function save() {
    if (!ready || saving) return;
    setSaving(true);
    try {
      const dueAt = new Date(Date.now() + DUE_IN_DAYS * 86_400_000).toISOString();
      const reference = nextInvoiceReference(store.invoices);
      const payee = account?.displayName.trim() ?? '';
      // The link is what makes an invoice real: it opens the invoice-style
      // checkout page, so it is built before anything is saved.
      const link = paymentCode
        ? buildCheckoutLink(window.location.origin, {
            code: paymentCode,
            kind: 'invoice',
            amountMinor: amount,
            currency: 'NGN',
            ...(payee ? { payee } : {}),
            reference,
            note: note.trim(),
            dueAt: localDay(dueAt),
          })
        : null;
      if (!link) return;
      await store.createInvoice({
        clientName: clientName.trim(),
        amountMinor: amount,
        note: note.trim(),
        dueAt,
        reference,
        link,
      });
      router.push('/business');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="New invoice" />

      <div className="flex-1 px-gutter pb-28">
        <p className="font-heavy text-body-sm text-ink">Bill to</p>
        <input
          value={clientName}
          onChange={(event) => setClientName(event.target.value)}
          placeholder="Client or business name"
          className="mt-2.5 w-full rounded-control border border-line bg-card px-4 py-3.5 font-body text-body text-ink placeholder:text-mist"
        />

        <p className="mt-5 font-heavy text-body-sm text-ink">For</p>
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What this invoice is for"
          className="mt-2.5 w-full rounded-control border border-line bg-card px-4 py-3.5 font-body text-body text-ink placeholder:text-mist"
        />

        <p className="mt-6 font-heavy text-body-sm text-ink">Amount</p>
        <p className="tabular mt-2.5 font-strong text-amount text-ink">₦{entryDisplay(entry)}</p>
        <p className="mt-1.5 font-body text-label-sm text-slate">Due in {DUE_IN_DAYS} days</p>

        <div className="mt-4">
          <Keypad onKey={(key) => setEntry((current) => pressKey(current, key))} />
        </div>

        <button
          type="button"
          disabled={!ready || saving}
          onClick={() => void save()}
          className="mt-4 flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep disabled:opacity-60"
        >
          {saving ? 'Sending' : 'Send invoice'}
        </button>
      </div>
    </main>
  );
}
