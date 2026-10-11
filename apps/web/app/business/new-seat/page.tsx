'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { cadenceWords } from '@entole/core/allowance';
import { entryToMinor, pressKey, type AmountEntry, EMPTY_ENTRY } from '@entole/core/amount-entry';
import { formatNaira, kobo, type Naira } from '@entole/core/money';
import type { Cadence, SeatRole } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

import { Header } from '@/components/Header';
import { Keypad } from '@/components/Keypad';

const CADENCES: Cadence[] = ['weekly', 'monthly', 'on-request'];
const ROLES: { value: SeatRole; label: string; spends: boolean }[] = [
  { value: 'officer', label: 'Officer', spends: true },
  { value: 'admin', label: 'Admin', spends: false },
  { value: 'bookkeeper', label: 'Bookkeeper', spends: false },
];

/** A seat is spending power granted to a person instead of to the
 * assistant — the same allowance primitive, a different grantee. */
export default function NewSeatPage() {
  const router = useRouter();
  const store = useStore();

  const [role, setRole] = useState<SeatRole>('officer');
  const [contactId, setContactId] = useState(store.contacts[0]?.id ?? '');
  const [cadence, setCadence] = useState<Cadence>('monthly');
  const [perRunEntry, setPerRunEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [limitEntry, setLimitEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [editingLimit, setEditingLimit] = useState(false);
  const [saving, setSaving] = useState(false);

  const person = store.contact(contactId);
  const spends = ROLES.find((r) => r.value === role)?.spends ?? false;
  const perRun: Naira = kobo(entryToMinor(perRunEntry));
  const limit: Naira = kobo(entryToMinor(limitEntry));
  const ready = Boolean(person) && (!spends || (perRun > 0 && limit >= perRun));

  async function save() {
    if (!person || !ready || saving) return;
    setSaving(true);
    try {
      await store.saveSeat({
        name: `${ROLES.find((r) => r.value === role)?.label} — ${person.name.split(' ')[0]}`,
        contactId,
        role,
        perRunMinor: spends ? perRun : 0,
        limitMinor: spends ? limit : 0,
        cadence: spends ? cadence : 'on-request',
      });
      router.push('/business');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="New seat" />

      <div className="flex-1 px-gutter pb-28">
        <p className="font-display text-subhead text-ink">What they can do</p>
        <div className="mt-2.5 flex flex-col gap-2">
          {ROLES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setRole(option.value)}
              className={`flex items-center justify-between rounded-control border px-4 py-3.5 ${
                option.value === role ? 'border-ink bg-card' : 'border-hairline bg-paper'
              }`}
            >
              <span className={`font-body text-ui ${option.value === role ? 'font-strong text-ink' : 'text-slate'}`}>
                {option.label}
              </span>
              <span className={`font-strong text-note ${option.value === role ? 'text-ink' : 'text-slate'}`}>
                {option.spends ? 'Capped allowance' : 'No spend'}
              </span>
            </button>
          ))}
        </div>

        <p className="mt-5 font-display text-subhead text-ink">Who it goes to</p>
        <select
          value={contactId}
          onChange={(event) => setContactId(event.target.value)}
          className="mt-2.5 w-full rounded-control border border-line bg-card px-4 py-3.5 font-body text-ui text-ink"
        >
          {store.contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name}
            </option>
          ))}
        </select>

        {spends ? (
          <>
            <p className="mt-5 font-display text-subhead text-ink">How often</p>
            <div className="mt-2.5 flex gap-2">
              {CADENCES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setCadence(option)}
                  className={`flex-1 rounded-control border px-3 py-2.5 font-strong text-note ${
                    option === cadence ? 'border-ink bg-card text-ink' : 'border-hairline bg-paper text-slate'
                  }`}
                >
                  {cadenceWords(option)}
                </button>
              ))}
            </div>

            <div className="mt-6 flex items-baseline justify-between">
              <p className="font-display text-subhead text-ink">
                {editingLimit ? 'Never more than, per period' : 'How much each time'}
              </p>
              <p className="tabular font-strong text-subhead text-ink">{formatNaira(editingLimit ? limit : perRun)}</p>
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
              className="mt-2 font-strong text-note text-ink underline decoration-mist underline-offset-4 hover:decoration-ink"
            >
              {editingLimit ? 'Set the per-payment amount instead' : 'Set the overall cap instead'}
            </button>
          </>
        ) : null}

        <button
          type="button"
          disabled={!ready || saving}
          onClick={() => void save()}
          className="mt-5 flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 disabled:opacity-60"
        >
          {saving ? 'Granting' : 'Grant seat'}
        </button>
      </div>
    </main>
  );
}
