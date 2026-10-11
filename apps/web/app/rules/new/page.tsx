'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { cadenceDetail, cadenceWords } from '@entole/core/allowance';
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

import { Avatar } from '@/components/Avatar';
import { Header } from '@/components/Header';
import { Keypad } from '@/components/Keypad';
import { PageLoader } from '@/components/LogoLoader';
import { Sentence, type SentencePart } from '@/components/Sentence';
import { Skeleton } from '@/components/Skeleton';

const CADENCES: Cadence[] = ['weekly', 'monthly', 'on-request'];

type Blank = 'each' | 'who' | 'often' | 'limit';

/** Which of a list is chosen: a ring, with a dot in it for the one that is. */
function RadioMark({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-5 w-5 flex-none items-center justify-center rounded-pill border-[1.5px] ${
        selected ? 'border-ink' : 'border-line'
      }`}
    >
      {selected ? <span className="h-2.5 w-2.5 rounded-pill bg-ink" /> : null}
    </span>
  );
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * An allowance is a sentence you fill in: how much, to whom, how often, and
 * the most it may ever come to. Press a value and it opens below; the sentence
 * above always reads back in one breath. The limit is enforced on the
 * contract, never a permission or a toggle.
 *
 * The limit starts at one payment and follows it until the person sets it
 * themselves, so the allowance can be created as soon as there is an amount,
 * and what would stop it is said.
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
  const [editing, setEditing] = useState<Blank>('each');
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

  const parts: SentencePart[] = [
    { kind: 'words', text: 'Send ' },
    { kind: 'blank', id: 'each', text: each > 0 ? formatNaira(each) : 'an amount', filled: each > 0 },
    { kind: 'words', text: ' to ' },
    { kind: 'blank', id: 'who', text: recipient?.name ?? 'someone', filled: Boolean(recipient) },
    { kind: 'words', text: ' ' },
    { kind: 'blank', id: 'often', text: cadenceWords(cadence), filled: true },
    { kind: 'words', text: ', never more than ' },
    { kind: 'blank', id: 'limit', text: limit > 0 ? formatNaira(limit) : 'a limit', filled: limit > 0 },
    { kind: 'words', text: ` ${period}.` },
  ];

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
          <h2 className="font-display text-heading text-ink">Save someone first</h2>
          <p className="mt-2.5 text-pretty font-body text-prose text-slate">
            An allowance is for one person you have saved. Pay them once with their payment code, then save them
            from the receipt.
          </p>
          <Link
            href="/transfer/send"
            className="mt-7 flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px"
          >
            Pay someone
          </Link>
        </div>
      ) : store.status === 'loading' ? (
        <div className="flex-1 px-gutter pb-28 pt-3">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="mt-3 h-9 w-72" />
          <Skeleton className="mt-3 h-9 w-48" />
          <Skeleton className="mt-8 h-[280px] w-full rounded-card" />
        </div>
      ) : store.status === 'failed' ? (
        <div className="flex-1 px-gutter pb-28 pt-3">
          <p className="font-body text-ui text-slate">We couldn&apos;t load your beneficiaries.</p>
          <button
            type="button"
            onClick={() => void store.refresh().catch(() => undefined)}
            className="mt-2 font-strong text-ui text-ink underline decoration-mist underline-offset-4 transition-colors hover:decoration-ink"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col px-gutter pb-28 pt-3">
          <Sentence parts={parts} activeId={editing} onPick={(id) => setEditing(id as Blank)} />
          <p className="mt-3 font-body text-note text-slate">Press any value to change it.</p>

          <section className="mt-7 rounded-card bg-card p-5 shadow-raised">
            {editing === 'who' ? (
              <>
                <h2 className="font-strong text-ui text-ink">Who it goes to</h2>
                <ul className="mt-2" role="radiogroup" aria-label="Who it goes to">
                  {store.contacts.map((contact, index) => {
                    const selected = contact.id === recipientId;
                    return (
                      <li key={contact.id} className={index > 0 ? 'border-t border-hairline' : ''}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setPicked(contact.id)}
                          className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-control px-2 py-3 text-left transition-colors hover:bg-press"
                        >
                          <Avatar initials={contact.initials} tone={contact.tone} />
                          <span className="min-w-0 flex-1 truncate font-strong text-ui text-ink">{contact.name}</span>
                          <RadioMark selected={selected} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : editing === 'often' ? (
              <>
                <h2 className="font-strong text-ui text-ink">How often</h2>
                <ul className="mt-2" role="radiogroup" aria-label="How often">
                  {CADENCES.map((option, index) => {
                    const selected = option === cadence;
                    return (
                      <li key={option} className={index > 0 ? 'border-t border-hairline' : ''}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setCadence(option)}
                          className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-control px-2 py-3.5 text-left transition-colors hover:bg-press"
                        >
                          <span className="flex-1 font-strong text-ui text-ink">{sentenceCase(cadenceWords(option))}</span>
                          <span className="font-body text-note text-slate">{cadenceDetail(option)}</span>
                          <RadioMark selected={selected} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-strong text-ui text-ink">
                    {editing === 'each' ? 'How much each time' : `Never more than, ${period}`}
                  </h2>
                  <p className="tabular font-display text-subhead text-ink">
                    {formatNaira(editing === 'each' ? each : limit)}
                  </p>
                </div>
                {editing === 'limit' && !limitEntry ? (
                  <p className="mt-1 font-body text-note text-slate">It starts at one payment. Type to raise it.</p>
                ) : null}
                <div className="mt-3">
                  <Keypad onKey={press} />
                </div>
              </>
            )}
          </section>

          <p
            role={problem ? 'alert' : undefined}
            className={`mt-4 min-h-[20px] text-center font-body text-note ${problem ? 'text-halt' : 'text-slate'}`}
          >
            {problem ?? missing ?? ''}
          </p>

          <button
            type="button"
            disabled={!ready || saving}
            onClick={() => void save()}
            className="mt-2 flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:opacity-60"
          >
            {saving ? 'Creating' : 'Create allowance'}
          </button>
        </div>
      )}
    </main>
  );
}

export default function NewRulePage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <NewRule />
    </Suspense>
  );
}
