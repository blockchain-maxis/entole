'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { useBackend } from '@entole/core/backend';
import { beneficiaryFromOneOff, suggestedNameFor } from '@entole/core/save-recipient';
import { useStore } from '@entole/core/store';

const COULD_NOT_SAVE = "We couldn't save them. Your payment is not affected. Try again.";

/**
 * Saves someone just paid, from the receipt. A saved person can be paid again
 * in a couple of taps, and is who an allowance is set for, so without this the
 * browser has no way to reach either.
 *
 * Their name is already known: the directory gave it when they were found by
 * username or number. So it is shown, not asked for, and the one thing to add
 * is a nickname, if the person wants one. A name is only asked for when
 * nothing named them, which is a link from before usernames. Where their money
 * lands is never shown.
 */
export function SaveRecipient({ recipientId }: { recipientId: string }) {
  const store = useStore();
  const { source } = useBackend();
  const known = suggestedNameFor(recipientId);
  const [typedName, setTypedName] = useState('');
  const [nickname, setNickname] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; name: string; already: boolean } | null>(null);
  const name = known || typedName;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setProblem(null);
    try {
      // Read again here: this list is the authority on who is already saved.
      const existing = await source.listBeneficiaries();
      const outcome = beneficiaryFromOneOff({
        recipientId,
        name,
        nickname,
        existing,
        id: crypto.randomUUID(),
        now: new Date(),
      });
      if (!outcome.ok) {
        if (outcome.kind === 'already-saved') {
          setDone({ id: outcome.as.id, name: outcome.as.nickname ?? outcome.as.name, already: true });
        } else {
          setProblem(outcome.kind === 'no-name' ? 'Enter their name.' : COULD_NOT_SAVE);
        }
        return;
      }
      await source.saveBeneficiary(outcome.beneficiary);
      await store.refresh().catch(() => undefined);
      const saved = outcome.beneficiary;
      setDone({ id: saved.id, name: saved.nickname ?? saved.name, already: false });
    } catch {
      setProblem(COULD_NOT_SAVE);
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <section role="status" className="rounded-card border border-line bg-card px-[18px] py-4">
        <p className="font-strong text-ui text-ink">
          {done.already ? `You already saved them as ${done.name}` : `${done.name} is saved`}
        </p>
        <p className="mt-1 text-pretty font-body text-note text-slate">
          You can pay them again in two taps, or let the assistant pay them inside an allowance.
        </p>
        <Link
          href={`/rules/new?for=${encodeURIComponent(done.id)}`}
          className="mt-2.5 inline-block font-strong text-ui text-ink underline decoration-mist underline-offset-4 hover:decoration-ink"
        >
          Set an allowance for them
        </Link>
      </section>
    );
  }

  return (
    <form
      onSubmit={(event) => void save(event)}
      className="rounded-card border border-line bg-card px-[18px] py-4"
    >
      <p className="font-strong text-ui text-ink">{known ? `Save ${known}` : 'Save them for next time'}</p>
      <p id="save-help" className="mt-1 text-pretty font-body text-note text-slate">
        {known
          ? 'You can pay them again in two taps. Add a nickname if you call them something else.'
          : 'Give them a name and you can pay them again in two taps.'}
      </p>
      {known ? null : (
        <>
          <label htmlFor="save-name" className="mt-3 block font-strong text-note text-slate">
            Name
          </label>
          <input
            id="save-name"
            value={typedName}
            onChange={(event) => {
              setTypedName(event.target.value);
              setProblem(null);
            }}
            placeholder="Their name"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="next"
            maxLength={60}
            aria-invalid={problem ? true : undefined}
            className={`mt-2 h-12 w-full rounded-control border-[1.5px] bg-paper px-4 font-body text-ui text-ink outline-none placeholder:text-mist focus:border-ink ${
              problem ? 'border-halt' : 'border-line'
            }`}
          />
        </>
      )}
      <label htmlFor="save-nickname" className="mt-3 block font-strong text-note text-slate">
        Nickname <span className="font-body text-mist">Optional</span>
      </label>
      <div className="mt-2 flex gap-2.5">
        <input
          id="save-nickname"
          value={nickname}
          onChange={(event) => {
            setNickname(event.target.value);
            setProblem(null);
          }}
          placeholder="What you call them"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
          maxLength={60}
          aria-describedby={problem ? 'save-problem' : 'save-help'}
          className="h-12 min-w-0 flex-1 rounded-control border-[1.5px] border-line bg-paper px-4 font-body text-ui text-ink outline-none placeholder:text-mist focus:border-ink"
        />
        <button
          type="submit"
          disabled={saving || name.trim().length === 0}
          className="flex h-12 flex-none items-center justify-center rounded-control bg-ink px-5 font-strong text-ui text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:opacity-60"
        >
          {saving ? 'Saving' : 'Save'}
        </button>
      </div>
      {problem ? (
        <p id="save-problem" role="alert" className="mt-2 font-body text-note text-halt">
          {problem}
        </p>
      ) : null}
    </form>
  );
}
