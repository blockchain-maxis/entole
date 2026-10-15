'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { useBackend } from '@entole/core/backend';
import { draftFrom, draftProblems, toRecordFields, type BeneficiaryDraft } from '@entole/core/beneficiary-draft';
import { COUNTRIES } from '@entole/core/countries';
import { toContact, type Beneficiary } from '@entole/core/records';
import { useStore } from '@entole/core/store';

import { Avatar } from '@/components/Avatar';
import { Header } from '@/components/Header';
import { LogoLoader } from '@/components/LogoLoader';
import { RowSkeleton } from '@/components/Skeleton';

type Load = { state: 'loading' } | { state: 'missing' } | { state: 'ready'; beneficiary: Beneficiary };

const FIELD =
  'mt-2 h-12 w-full rounded-control border-[1.5px] border-line bg-card px-4 font-body text-ui text-ink outline-none transition-colors placeholder:text-mist focus:border-ink disabled:opacity-60';
const LABEL = 'block font-strong text-note text-slate';

/**
 * One saved person: their name and nickname, where they live, and a bank
 * account to keep on file, all theirs to change; and removing them. Where
 * their money goes is not shown or changed here: a different account is a
 * different person, so that is someone new.
 *
 * Someone an allowance or a seat pays cannot be removed from under it; the
 * sheet says so instead. Mirrors `apps/mobile/app/beneficiaries/[id].tsx`.
 */
export default function BeneficiaryPage() {
  const router = useRouter();
  const store = useStore();
  const { source } = useBackend();
  const id = decodeURIComponent(String(useParams<{ id: string }>().id ?? ''));

  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [draft, setDraft] = useState<BeneficiaryDraft | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [busy, setBusy] = useState<'saving' | 'removing' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    source
      .listBeneficiaries()
      .then((list) => {
        if (!live) return;
        const found = list.find((entry) => entry.id === id);
        if (!found) {
          setLoad({ state: 'missing' });
          return;
        }
        setLoad({ state: 'ready', beneficiary: found });
        setDraft(draftFrom(found));
      })
      .catch(() => live && setLoad({ state: 'missing' }));
    return () => {
      live = false;
    };
  }, [id, source]);

  const problems = draft ? draftProblems(draft) : {};
  const blocker = problems.name ?? problems.bankName ?? problems.accountNumber ?? null;

  // A person an allowance or a seat pays cannot vanish from under it.
  const inUse =
    store.allowances.some((allowance) => allowance.recipientId === id) ||
    store.seats.some((seat) => seat.recipientId === id);

  function change(patch: Partial<BeneficiaryDraft>) {
    setSaved(false);
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (load.state !== 'ready' || !draft || blocker || busy) return;
    setBusy('saving');
    setProblem(null);
    try {
      const { beneficiary } = load;
      const next = {
        id: beneficiary.id,
        address: beneficiary.address,
        tone: beneficiary.tone,
        createdAt: beneficiary.createdAt,
        ...toRecordFields(draft),
      };
      await source.saveBeneficiary(next);
      await store.refresh().catch(() => undefined);
      setLoad({ state: 'ready', beneficiary: next });
      setSaved(true);
    } catch {
      setProblem("We couldn't save your changes. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (load.state !== 'ready' || inUse || busy) return;
    setBusy('removing');
    setProblem(null);
    try {
      await source.removeBeneficiary(load.beneficiary.id);
      await store.refresh().catch(() => undefined);
      router.replace('/beneficiaries');
    } catch {
      setProblem("We couldn't remove them. Nothing was changed. Try again.");
      setConfirmingRemove(false);
      setBusy(null);
    }
  }

  const shown = load.state === 'ready' ? toContact(load.beneficiary) : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title={shown?.name ?? 'Beneficiary'} back="/beneficiaries" />

      {load.state === 'loading' ? (
        <div className="px-gutter pt-2">
          <RowSkeleton />
          <RowSkeleton />
        </div>
      ) : load.state === 'missing' || !draft || !shown ? (
        <div className="flex flex-1 flex-col items-start px-gutter pt-6">
          <p className="text-pretty font-body text-ui text-slate">
            That person is no longer saved here. They may have been removed.
          </p>
          <Link
            href="/beneficiaries"
            className="mt-4 font-strong text-ui text-ink underline decoration-mist underline-offset-4 hover:decoration-ink"
          >
            Back to beneficiaries
          </Link>
        </div>
      ) : (
        <form onSubmit={(event) => void save(event)} className="flex flex-1 flex-col px-gutter pb-28 pt-2">
          <div className="flex items-center gap-3 border-b border-hairline pb-4">
            <Avatar initials={shown.initials} tone={shown.tone} />
            <p className="min-w-0 flex-1 truncate font-display text-subhead text-ink">{shown.name}</p>
            <Link
              href={`/transfer/send?contact=${encodeURIComponent(id)}`}
              className="flex h-10 flex-none items-center rounded-control bg-ink px-4 font-strong text-ui text-paper transition-colors hover:bg-ink/85 active:translate-y-px"
            >
              Pay
            </Link>
          </div>

          <div className="flex-1">
            <label htmlFor="name" className={`mt-5 ${LABEL}`}>
              Name
            </label>
            <input
              id="name"
              value={draft.name}
              onChange={(event) => change({ name: event.target.value })}
              autoComplete="off"
              maxLength={60}
              disabled={busy !== null}
              aria-invalid={Boolean(problems.name)}
              className={FIELD}
            />
            {problems.name ? <p className="mt-2 font-body text-note text-halt">{problems.name}</p> : null}

            <label htmlFor="nickname" className={`mt-5 ${LABEL}`}>
              Nickname <span className="font-body text-mist">(optional)</span>
            </label>
            <input
              id="nickname"
              value={draft.nickname}
              onChange={(event) => change({ nickname: event.target.value })}
              placeholder="What you call them"
              autoComplete="off"
              maxLength={60}
              disabled={busy !== null}
              className={FIELD}
            />

            <label htmlFor="country" className={`mt-5 ${LABEL}`}>
              Where they live <span className="font-body text-mist">(optional)</span>
            </label>
            <select
              id="country"
              value={draft.country ?? ''}
              onChange={(event) => change({ country: event.target.value || undefined })}
              disabled={busy !== null}
              className={FIELD}
            >
              <option value="">Not said</option>
              {COUNTRIES.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </select>

            <fieldset className="mt-7 border-t border-hairline pt-4">
              <legend className="pr-2 font-strong text-ui text-ink">Bank account on file</legend>
              <p className="mt-1 text-pretty font-body text-note text-slate">
                Optional. Kept for later, for paying out to a bank. Nothing uses it to move money today.
              </p>

              <label htmlFor="bank" className={`mt-4 ${LABEL}`}>
                Bank
              </label>
              <input
                id="bank"
                value={draft.bankName}
                onChange={(event) => change({ bankName: event.target.value })}
                autoComplete="off"
                disabled={busy !== null}
                aria-invalid={Boolean(problems.bankName)}
                className={FIELD}
              />
              {problems.bankName ? <p className="mt-2 font-body text-note text-halt">{problems.bankName}</p> : null}

              <label htmlFor="account-number" className={`mt-4 ${LABEL}`}>
                Account number
              </label>
              <input
                id="account-number"
                value={draft.accountNumber}
                onChange={(event) => change({ accountNumber: event.target.value })}
                autoComplete="off"
                spellCheck={false}
                disabled={busy !== null}
                aria-invalid={Boolean(problems.accountNumber)}
                className={`${FIELD} tabular-nums`}
              />
              {problems.accountNumber ? (
                <p className="mt-2 font-body text-note text-halt">{problems.accountNumber}</p>
              ) : null}

              <label htmlFor="account-name" className={`mt-4 ${LABEL}`}>
                Name on the account <span className="font-body text-mist">(optional)</span>
              </label>
              <input
                id="account-name"
                value={draft.accountName}
                onChange={(event) => change({ accountName: event.target.value })}
                autoComplete="off"
                disabled={busy !== null}
                className={FIELD}
              />
            </fieldset>

            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              disabled={busy !== null}
              className="mt-8 font-strong text-ui text-halt underline decoration-halt/40 underline-offset-4 transition-colors hover:decoration-halt disabled:opacity-60"
            >
              Remove {shown.name}
            </button>
          </div>

          <p
            role={problem ? 'alert' : saved ? 'status' : undefined}
            className={`mt-6 min-h-[20px] text-center font-body text-note ${problem ? 'text-halt' : 'text-slate'}`}
          >
            {problem ?? (saved ? 'Saved.' : blocker ?? '')}
          </p>
          <button
            type="submit"
            disabled={Boolean(blocker) || busy !== null}
            className="mt-2 flex h-14 w-full items-center justify-center gap-2.5 rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:opacity-60"
          >
            {busy === 'saving' ? <LogoLoader size={20} label="Saving" mono /> : null}
            {busy === 'saving' ? 'Saving' : 'Save changes'}
          </button>
        </form>
      )}

      {confirmingRemove && shown ? (
        <RemoveSheet
          name={shown.name}
          inUse={inUse}
          removing={busy === 'removing'}
          onRemove={() => void remove()}
          onDismiss={() => setConfirmingRemove(false)}
        />
      ) : null}
    </main>
  );
}

/**
 * Removing, asked once more, from the bottom of the page. While an allowance
 * or a seat pays them it says what to change first instead of offering to.
 */
function RemoveSheet({
  name,
  inUse,
  removing,
  onRemove,
  onDismiss,
}: {
  name: string;
  inUse: boolean;
  removing: boolean;
  onRemove: () => void;
  onDismiss: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !removing) onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss, removing]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        onClick={removing ? undefined : onDismiss}
        className="scrim-fade absolute inset-0 bg-scrim"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-title"
        tabIndex={-1}
        className="sheet-rise relative w-full max-w-[560px] rounded-t-sheet bg-card px-gutter-lg pb-[max(20px,env(safe-area-inset-bottom))] pt-3 shadow-floating outline-none"
      >
        <div aria-hidden className="mx-auto h-1 w-10 rounded-pill bg-line" />
        <h2 id="remove-title" className="mt-5 font-display text-subhead text-ink">
          Remove {name}?
        </h2>
        <p className="mt-2 text-pretty font-body text-ui text-slate">
          {inUse
            ? `An allowance or seat pays ${name}. Remove or change that first, then you can remove them here.`
            : 'They will no longer appear when you pay someone. Payments you have already made stay in your activity.'}
        </p>
        <div className="mt-6 flex flex-col gap-2.5">
          {inUse ? null : (
            <button
              type="button"
              onClick={onRemove}
              disabled={removing}
              className="flex h-14 w-full items-center justify-center gap-2.5 rounded-control bg-halt font-strong text-prose text-paper transition-opacity active:translate-y-px disabled:opacity-70"
            >
              {removing ? <LogoLoader size={20} label="Removing" mono /> : null}
              {removing ? 'Removing' : `Remove ${name}`}
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            disabled={removing}
            className="flex h-14 w-full items-center justify-center rounded-control border border-line bg-card font-strong text-prose text-ink transition-colors hover:border-mist disabled:opacity-60"
          >
            {inUse ? 'Close' : 'Keep them'}
          </button>
        </div>
      </div>
    </div>
  );
}
