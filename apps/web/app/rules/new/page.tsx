'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { cadenceWords } from '@entole/core/allowance';
import { entryToMinor, pressKey, type AmountEntry, EMPTY_ENTRY } from '@entole/core/amount-entry';
import { formatNaira, kobo, type Naira } from '@entole/core/money';
import type { Cadence } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

import { Header } from '@/components/Header';
import { Keypad } from '@/components/Keypad';

const CADENCES: Cadence[] = ['weekly', 'monthly', 'on-request'];

/**
 * A rule, written in plain terms. Simpler than the phone app's tap-to-edit
 * sentence builder, but the same three facts: who, how much, how often —
 * enforced on the contract, never a permission or a toggle.
 */
export default function NewRulePage() {
  const router = useRouter();
  const store = useStore();

  const [recipientId, setRecipientId] = useState(store.contacts[0]?.id ?? '');
  const [cadence, setCadence] = useState<Cadence>('monthly');
  const [perRunEntry, setPerRunEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [limitEntry, setLimitEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [editingLimit, setEditingLimit] = useState(false);
  const [saving, setSaving] = useState(false);

  const recipient = store.contact(recipientId);
  const perRun: Naira = kobo(entryToMinor(perRunEntry));
  const limit: Naira = kobo(entryToMinor(limitEntry));
  const ready = Boolean(recipient) && perRun > 0 && limit >= perRun;

  async function save() {
    if (!recipient || !ready || saving) return;
    setSaving(true);
    try {
      await store.saveAllowance({
        name: `${cadenceWords(cadence)} to ${recipient.name}`,
        recipientId,
        perRunMinor: perRun,
        limitMinor: limit,
        cadence,
      });
      router.push('/');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="New rule" />

      <div className="flex-1 px-gutter pb-28">
        <p className="font-heavy text-body-sm text-ink">Who it goes to</p>
        <select
          value={recipientId}
          onChange={(event) => setRecipientId(event.target.value)}
          className="mt-2.5 w-full rounded-control border border-line bg-card px-4 py-3.5 font-body text-body text-ink"
        >
          {store.contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name}
            </option>
          ))}
        </select>

        <p className="mt-5 font-heavy text-body-sm text-ink">How often</p>
        <div className="mt-2.5 flex gap-2">
          {CADENCES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setCadence(option)}
              className={`flex-1 rounded-chip border px-3 py-2.5 font-strong text-label-sm ${
                option === cadence ? 'border-indigo bg-indigo-wash text-indigo' : 'border-hairline bg-paper text-slate'
              }`}
            >
              {cadenceWords(option)}
            </button>
          ))}
        </div>

        <div className="mt-6 flex items-baseline justify-between">
          <p className="font-heavy text-body-sm text-ink">
            {editingLimit ? 'Never more than, per period' : 'How much each time'}
          </p>
          <p className="tabular font-strong text-amount-sm text-ink">
            {formatNaira(editingLimit ? limit : perRun)}
          </p>
        </div>
        <div className="mt-3">
          <Keypad
            onKey={(key) =>
              editingLimit
                ? setLimitEntry((current) => pressKey(current, key))
                : setPerRunEntry((current) => pressKey(current, key))
            }
          />
        </div>
        <button
          type="button"
          onClick={() => setEditingLimit((v) => !v)}
          className="mt-2 font-strong text-label-sm text-indigo"
        >
          {editingLimit ? 'Set the per-payment amount instead' : 'Set the overall cap instead'}
        </button>

        {limit > 0 && limit < perRun ? (
          <p className="mt-3 text-center font-body text-label-sm text-caution">
            The cap has to be at least as large as one payment.
          </p>
        ) : null}

        <button
          type="button"
          disabled={!ready || saving}
          onClick={() => void save()}
          className="mt-5 flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep disabled:opacity-60"
        >
          {saving ? 'Creating' : 'Create rule'}
        </button>
      </div>
    </main>
  );
}
