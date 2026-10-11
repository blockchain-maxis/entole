'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { cadenceWords } from '@entole/core/allowance';
import {
  EMPTY_ENTRY,
  entryFromMinor,
  entryToMinor,
  pressKey,
  type AmountEntry,
} from '@entole/core/amount-entry';
import { formatNaira, kobo, type Naira } from '@entole/core/money';
import type { Cadence } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

import { Header } from '@/components/Header';
import { Keypad } from '@/components/Keypad';
import { Skeleton } from '@/components/Skeleton';

const CADENCES: Cadence[] = ['weekly', 'monthly', 'on-request'];

type Editing = 'each' | 'limit';

/**
 * An allowance, written in plain terms. Simpler than the phone app's
 * tap-to-edit sentence, but the same facts: who, how often, how much each
 * time, and the most it may ever come to. The limit is enforced on the
 * contract, never a permission or a toggle.
 *
 * Both amounts are always on screen. The limit starts at one payment and
 * follows it until the person sets it themselves, so the allowance can be
 * created as soon as there is an amount, and what would stop it is said.
 *
 * `?for=` names the saved person it starts on, for arriving straight from
 * saving them.
 */
function NewRule() {
  const router = useRouter();
  const store = useStore();
  const preset = useSearchParams().get('for');

  // Nothing is held until the person chooses: the saved people may not have
  // loaded when this first renders, and a list of one cannot be re-chosen.
  const [picked, setPicked] = useState<string | null>(null);
  const [cadence, setCadence] = useState<Cadence>('monthly');
  const [eachEntry, setEachEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  // Null until the person sets a limit of their own.
  const [limitEntry, setLimitEntry] = useState<AmountEntry | null>(null);
  const [editing, setEditing] = useState<Editing>('each');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const presetId = store.contacts.some((contact) => contact.id === preset) ? preset : null;
  const recipientId = picked ?? presetId ?? store.contacts[0]?.id ?? '';
  const recipient = recipientId ? store.contact(recipientId) : undefined;
  const each: Naira = kobo(entryToMinor(eachEntry));
  const limit: Naira = limitEntry ? kobo(entryToMinor(limitEntry)) : each;
  const period = cadence === 'weekly' ? 'a week' : 'a month';

  const missing = !recipient
    ? null
    : each <= 0
      ? 'Enter how much each payment is.'
      : limit < each
        ? 'The limit has to cover at least one payment.'
        : null;
  const ready = Boolean(recipient) && each > 0 && limit >= each;

  function press(key: string) {
    setProblem(null);
    if (editing === 'each') {
      setEachEntry((current) => pressKey(current, key));
      return;
    }
    // The first key carries on from the figure already shown.
    setLimitEntry((current) => pressKey(current ?? entryFromMinor(each), key));
  }

  async function save() {
    if (!recipient || !ready || saving) return;
    setSaving(true);
    setProblem(null);
    try {
      await store.saveAllowance({
        name: `${cadenceWords(cadence)} to ${recipient.name}`,
        recipientId,
        perRunMinor: each,
        limitMinor: limit,
        cadence,
      });
      router.push('/');
    } catch {
      setProblem("We couldn't create that allowance. Nothing has changed. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="New allowance" back="/" />

      {store.status === 'ready' && store.contacts.length === 0 ? (
        <div className="flex-1 px-gutter pb-28 pt-2">
          <h2 className="font-strong text-headline text-ink">Save someone first</h2>
          <p className="mt-2.5 text-pretty font-body text-body-sm text-slate">
            An allowance is for one person you have saved. Pay them once with their payment code, then save them
            from the receipt.
          </p>
          <Link
            href="/transfer/send"
            className="mt-7 flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep active:translate-y-px"
          >
            Pay someone
          </Link>
        </div>
      ) : (
        <div className="flex-1 px-gutter pb-28">
          <label htmlFor="rule-recipient" className="block font-heavy text-body-sm text-ink">
            Who it goes to
          </label>
          {store.status === 'loading' ? (
            <Skeleton className="mt-2.5 h-[52px] w-full rounded-control" />
          ) : store.status === 'failed' ? (
            <div className="mt-2.5">
              <p className="font-body text-label-sm text-slate">We couldn&apos;t load the people you saved.</p>
              <button
                type="button"
                onClick={() => void store.refresh().catch(() => undefined)}
                className="mt-2 font-strong text-label-sm text-indigo hover:text-indigo-deep"
              >
                Try again
              </button>
            </div>
          ) : (
            <select
              id="rule-recipient"
              value={recipientId}
              onChange={(event) => setPicked(event.target.value)}
              className="mt-2.5 w-full rounded-control border border-line bg-card px-4 py-3.5 font-body text-body text-ink outline-none focus:border-indigo"
            >
              {store.contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                </option>
              ))}
            </select>
          )}

          <p className="mt-5 font-heavy text-body-sm text-ink">How often</p>
          <div className="mt-2.5 flex gap-2">
            {CADENCES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={option === cadence}
                onClick={() => setCadence(option)}
                className={`flex-1 rounded-chip border px-3 py-2.5 font-strong text-label-sm transition-colors ${
                  option === cadence
                    ? 'border-indigo bg-indigo-wash text-indigo'
                    : 'border-hairline bg-paper text-slate hover:border-mist'
                }`}
              >
                {cadenceWords(option)}
              </button>
            ))}
          </div>

          <p className="mt-6 font-heavy text-body-sm text-ink">How much</p>
          <div className="mt-2.5 flex flex-col gap-2" role="radiogroup" aria-label="Which amount the keypad changes">
            <AmountChoice
              label="Each payment"
              value={each}
              selected={editing === 'each'}
              onSelect={() => setEditing('each')}
            />
            <AmountChoice
              label={`Never more than, ${period}`}
              hint={limitEntry ? undefined : 'Starts at one payment. Choose it to raise it.'}
              value={limit}
              selected={editing === 'limit'}
              onSelect={() => setEditing('limit')}
            />
          </div>

          <div className="mt-3">
            <Keypad onKey={press} />
          </div>

          <p
            role={problem ? 'alert' : undefined}
            className={`mt-3 min-h-[20px] text-center font-body text-label-sm ${problem ? 'text-halt' : 'text-slate'}`}
          >
            {problem ?? missing ?? ''}
          </p>

          <button
            type="button"
            disabled={!ready || saving}
            onClick={() => void save()}
            className="mt-2 flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep active:translate-y-px disabled:opacity-60"
          >
            {saving ? 'Creating' : 'Create allowance'}
          </button>
        </div>
      )}
    </main>
  );
}

/** One of the two amounts. The chosen one is the one the keypad changes. */
function AmountChoice({
  label,
  hint,
  value,
  selected,
  onSelect,
}: {
  label: string;
  hint?: string | undefined;
  value: Naira;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex w-full items-center justify-between gap-3 rounded-control border-[1.5px] bg-card px-4 py-3 text-left transition-colors ${
        selected ? 'border-ink' : 'border-line hover:border-mist'
      }`}
    >
      <span className="min-w-0">
        <span className="block font-strong text-label text-ink">{label}</span>
        {hint ? <span className="mt-0.5 block font-body text-caption text-slate">{hint}</span> : null}
      </span>
      <span className={`tabular flex-none font-strong text-amount-sm ${selected ? 'text-ink' : 'text-slate'}`}>
        {formatNaira(value)}
      </span>
    </button>
  );
}

export default function NewRulePage() {
  return (
    <Suspense fallback={null}>
      <NewRule />
    </Suspense>
  );
}
