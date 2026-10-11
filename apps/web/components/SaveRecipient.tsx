'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { useBackend } from '@entole/core/backend';
import { beneficiaryFromOneOff, suggestedNameFor } from '@entole/core/save-recipient';
import { useStore } from '@entole/core/store';

const COULD_NOT_SAVE = "We couldn't save them. Your payment is not affected. Try again.";

/**
 * Saves someone just paid by their payment code, from the receipt. A saved
 * person can be paid again by name, and is who an allowance is set for, so
 * without this the browser has no way to reach either. Where their money
 * lands comes from the code they were paid with and is never shown.
 */
export function SaveRecipient({ recipientId }: { recipientId: string }) {
  const store = useStore();
  const { source } = useBackend();
  const [name, setName] = useState(() => suggestedNameFor(recipientId));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; name: string; already: boolean } | null>(null);

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
      setDone({ id: outcome.beneficiary.id, name: outcome.beneficiary.name, already: false });
    } catch {
      setProblem(COULD_NOT_SAVE);
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <section role="status" className="rounded-tile border border-line bg-card px-[18px] py-4">
        <p className="font-strong text-body text-ink">
          {done.already ? `You already saved them as ${done.name}` : `${done.name} is saved`}
        </p>
        <p className="mt-1 text-pretty font-body text-label-sm text-slate">
          You can pay them again without their code, or let the assistant pay them inside an allowance.
        </p>
        <Link
          href={`/rules/new?for=${encodeURIComponent(done.id)}`}
          className="mt-2.5 inline-block font-strong text-label text-indigo hover:text-indigo-deep"
        >
          Set an allowance for them
        </Link>
      </section>
    );
  }

  return (
    <form
      onSubmit={(event) => void save(event)}
      className="rounded-tile border border-line bg-card px-[18px] py-4"
    >
      <label htmlFor="save-name" className="block font-strong text-body text-ink">
        Save them for next time
      </label>
      <p id="save-help" className="mt-1 text-pretty font-body text-label-sm text-slate">
        Give them a name and you can pay them again without their code.
      </p>
      <div className="mt-3 flex gap-2.5">
        <input
          id="save-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setProblem(null);
          }}
          placeholder="Their name"
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
          maxLength={60}
          aria-describedby={problem ? 'save-problem' : 'save-help'}
          aria-invalid={problem ? true : undefined}
          className={`h-12 min-w-0 flex-1 rounded-control border-[1.5px] bg-paper px-4 font-body text-body text-ink outline-none placeholder:text-mist focus:border-indigo ${
            problem ? 'border-halt' : 'border-line'
          }`}
        />
        <button
          type="submit"
          disabled={saving || name.trim().length === 0}
          className="flex h-12 flex-none items-center justify-center rounded-control border border-line bg-card px-5 font-strong text-body text-ink transition-colors hover:border-mist active:translate-y-px disabled:opacity-60"
        >
          {saving ? 'Saving' : 'Save'}
        </button>
      </div>
      {problem ? (
        <p id="save-problem" role="alert" className="mt-2 font-body text-caption text-halt">
          {problem}
        </p>
      ) : null}
    </form>
  );
}
