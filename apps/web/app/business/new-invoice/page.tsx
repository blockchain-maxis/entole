'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { entryDisplay, entryToMinor, pressKey, type AmountEntry, EMPTY_ENTRY } from '@entole/core/amount-entry';
import { useBackend } from '@entole/core/backend';
import { buildCheckoutLink } from '@entole/core/checkout-link';
import { formatRate } from '@entole/core/fx';
import { localDay, nextInvoiceReference } from '@entole/core/invoices';
import { useStore } from '@entole/core/store';

import { Header } from '@/components/Header';
import { Keypad } from '@/components/Keypad';
import { useAccount } from '@/lib/account';

const DUE_IN_DAYS = 14;

/** How much above today's rate a held invoice still releases at. "Today's rate
 * or better" holds until the rate is at least as good as now; the others give
 * a little headroom so an invoice is not stranded by a small adverse move. */
const HOLD_PRESETS: { label: string; marginPercent: number }[] = [
  { label: "Today's rate or better", marginPercent: 0 },
  { label: 'Within 2%', marginPercent: 2 },
  { label: 'Within 5%', marginPercent: 5 },
];

/** One-click generation, reusing the same settlement-link surface a
 * personal payment request already has. */
export default function NewInvoicePage() {
  const router = useRouter();
  const store = useStore();
  const { paymentCode, inbox } = useBackend();
  const { account } = useAccount();

  const [clientName, setClientName] = useState('');
  const [note, setNote] = useState('');
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [saving, setSaving] = useState(false);
  const [hold, setHold] = useState(false);
  const [presetIndex, setPresetIndex] = useState(0);

  const amount = entryToMinor(entry);
  const ready = clientName.trim().length > 0 && note.trim().length > 0 && amount > 0;

  /** The rate the held invoice releases at or below, from the chosen preset. */
  function maxKoboPerDollar(): number {
    const margin = HOLD_PRESETS[presetIndex]?.marginPercent ?? 0;
    return Math.round((store.rate.koboPerDollar * (100 + margin)) / 100);
  }

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
      const releaseCondition = hold
        ? ({ type: 'fx-rate-at-or-below' as const, maxKoboPerDollar: maxKoboPerDollar() })
        : undefined;
      const invoice = await store.createInvoice({
        clientName: clientName.trim(),
        amountMinor: amount,
        note: note.trim(),
        dueAt,
        reference,
        link,
        ...(releaseCondition ? { releaseCondition } : {}),
      });
      // A held invoice waits on the Chainlink CRE release route, which finds it
      // by id in the server store. Mirror it there so the route has a real
      // invoice to release when the rate condition holds.
      if (invoice.status === 'pending-release') await inbox.syncInvoice(invoice);
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

        <div className="mt-6 flex items-center justify-between">
          <div className="min-w-0 pr-3">
            <p className="font-heavy text-body-sm text-ink">Hold for a better rate</p>
            <p className="mt-1 font-body text-label-sm text-slate">
              Release only when the exchange rate is right, so a swing between now and payment does
              not eat into what you receive.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={hold}
            aria-label="Hold for a better rate"
            onClick={() => setHold((on) => !on)}
            className={`relative h-7 w-12 flex-none rounded-full transition-colors ${hold ? 'bg-indigo' : 'bg-line'}`}
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-card transition-transform ${hold ? 'translate-x-5' : 'translate-x-0.5'}`}
            />
          </button>
        </div>

        {hold ? (
          <div className="mt-3">
            <div className="flex gap-2 rounded-control border border-line bg-card p-1.5">
              {HOLD_PRESETS.map((preset, index) => {
                const active = presetIndex === index;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setPresetIndex(index)}
                    className={`flex-1 rounded-chip py-2.5 font-strong text-label-sm transition-colors ${
                      active ? 'bg-indigo-wash text-ink' : 'text-mist hover:text-slate'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <p className="tabular mt-2 font-body text-label-sm text-slate">
              Releases at {formatRate({ koboPerDollar: maxKoboPerDollar(), quotedAt: '' })} or better.
              Now {formatRate(store.rate)}.
            </p>
          </div>
        ) : null}

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
