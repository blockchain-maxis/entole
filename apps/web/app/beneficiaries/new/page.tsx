'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState, type FormEvent } from 'react';

import { useBackend } from '@entole/core/backend';
import type { Checkout } from '@entole/core/checkout-link';
import { formatHandle } from '@entole/core/handle';
import { oneOffAddress } from '@entole/core/one-off';
import { initialsFor } from '@entole/core/profile';
import { findRecipient, readRecipient } from '@entole/core/recipient';
import { beneficiarySchema, type Beneficiary } from '@entole/core/records';
import { suggestedNameFor } from '@entole/core/save-recipient';
import { useStore } from '@entole/core/store';

import { Avatar } from '@/components/Avatar';
import { Header } from '@/components/Header';
import { LogoLoader, PageLoader } from '@/components/LogoLoader';
import { useAccount } from '@/lib/account';

const NOT_SOMEONE = "That doesn't look like a username or a phone number.";
const NAME_MAX = 60;

const FIELD =
  'h-12 w-full rounded-control border-[1.5px] border-line bg-card px-4 font-body text-ui text-ink outline-none transition-colors placeholder:text-mist focus:border-ink disabled:opacity-60';

export default function NewBeneficiaryPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <NewBeneficiary />
    </Suspense>
  );
}

/**
 * Save someone by their username or their phone number. It is typed or
 * pasted, and the directory says who it is. Their name is already theirs, so
 * it is shown, not asked for; the one thing to add is a nickname, what the
 * person calls them. Where their money goes is held only long enough to save
 * the record, and nothing here renders it.
 *
 * `?recipient=` is someone just paid: already known, so there is nothing to
 * look up. `?next=send` goes straight on to paying them. Mirrors
 * `apps/mobile/app/beneficiaries/new.tsx`.
 */
function NewBeneficiary() {
  const router = useRouter();
  const query = useSearchParams();
  const store = useStore();
  const { source, directory } = useBackend();
  const { account } = useAccount();
  const next = query.get('next');
  const recipient = query.get('recipient');

  // Someone just paid: who they are travels in the id, never as text on a page.
  const paid = useMemo(() => {
    const address = recipient ? oneOffAddress(recipient) : null;
    return address && recipient ? { address, name: suggestedNameFor(recipient) } : null;
  }, [recipient]);

  const [who, setWho] = useState('');
  const [whoTouched, setWhoTouched] = useState(false);
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [found, setFound] = useState<{ text: string; who: Checkout | 'nobody' } | null>(null);
  const [nickname, setNickname] = useState('');
  // Only asked for when nothing named them: a link from before usernames.
  const [typedName, setTypedName] = useState('');
  const [existing, setExisting] = useState<Beneficiary[]>([]);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    source
      .listBeneficiaries()
      .then((list) => live && setExisting(list))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [source]);

  // A username or a number names someone; the directory says who, a moment after typing stops.
  const sought = useMemo(() => (paid ? null : readRecipient(who)), [paid, who]);
  useEffect(() => {
    if (!sought) return;
    let live = true;
    const timer = setTimeout(() => {
      void findRecipient(directory, sought)
        .catch(() => null)
        .then((person) => {
          if (live) setFound({ text: who, who: person ?? 'nobody' });
        });
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [sought, who, directory]);

  const looked = sought && found?.text === who ? found.who : null;
  const person = looked && looked !== 'nobody' ? looked : null;
  const address = paid?.address ?? person?.address ?? null;
  const knownName = (paid?.name || person?.payee || '').trim();
  const name = knownName || typedName.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

  const own = address !== null && account?.owner.address.toLowerCase() === address.toLowerCase();
  const duplicate = useMemo(
    () => (address ? existing.find((entry) => entry.address.toLowerCase() === address.toLowerCase()) : undefined),
    [address, existing],
  );

  const typed = who.trim().length > 0;
  const written = sought?.kind === 'handle' ? formatHandle(sought.handle) : 'that';
  const whoError = own
    ? "That's you. Save someone else."
    : duplicate
      ? `You already have ${duplicate.name} saved.`
      : looked === 'nobody'
        ? `Nobody on Entole has ${written} yet.`
        : typed && !sought && whoTouched
          ? NOT_SOMEONE
          : null;
  const whoOk = address !== null && !own && !duplicate;
  const whoHint = sought && !person ? `Looking for ${written}.` : 'Their username, like @ada.eze, or their phone number.';
  const known = whoOk;

  const blocker = !whoOk
    ? paid
      ? whoError
      : 'Enter their username or number to continue.'
    : name
      ? null
      : 'Enter their name.';

  async function paste() {
    setPasteNote(null);
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        setPasteNote('There is nothing to paste. Copy their username or link first.');
        return;
      }
      setWho(text);
      setWhoTouched(true);
    } catch {
      setPasteNote("We couldn't read what you copied. Paste it into the box instead.");
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!whoOk || address === null || blocker || saving) return;
    setSaving(true);
    setProblem(null);
    try {
      // Read again here: this list is the authority on who is already saved,
      // and its length picks their avatar tone.
      const current = await source.listBeneficiaries();
      if (current.some((entry) => entry.address.toLowerCase() === address.toLowerCase())) {
        setExisting(current);
        return;
      }
      const called = nickname.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
      const parsed = beneficiarySchema.safeParse({
        id: crypto.randomUUID(),
        name,
        ...(called && called !== name ? { nickname: called } : {}),
        address,
        tone: (current.length % 3) + 1,
        createdAt: new Date().toISOString(),
      });
      if (!parsed.success) {
        setProblem('Check the details and try again.');
        return;
      }
      await source.saveBeneficiary(parsed.data);
      await store.refresh().catch(() => undefined);
      router.replace(
        next === 'send' ? `/transfer/send?contact=${encodeURIComponent(parsed.data.id)}` : '/beneficiaries',
      );
    } catch {
      setProblem("We couldn't save them. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Save someone" back="/beneficiaries" />

      <form onSubmit={(event) => void save(event)} className="flex flex-1 flex-col px-gutter pb-28 pt-2">
        <div className="flex-1">
          {paid ? null : (
            <>
              <p className="text-pretty font-body text-ui text-slate">
                Ask them for their username. It is on Receive in their app. Their phone number works too.
              </p>
              <label htmlFor="who" className="mt-5 block font-strong text-note text-slate">
                Username or number
              </label>
              <div className="mt-2 flex items-center gap-3">
                <input
                  id="who"
                  value={who}
                  onChange={(event) => {
                    setWho(event.target.value);
                    setPasteNote(null);
                  }}
                  onBlur={() => setWhoTouched(true)}
                  placeholder="@username or 0803 123 4567"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={saving}
                  aria-invalid={Boolean(whoError)}
                  aria-describedby="who-note"
                  className={FIELD}
                />
                <button
                  type="button"
                  onClick={() => void paste()}
                  className="flex-none font-strong text-ui text-ink underline decoration-mist underline-offset-4 transition-colors hover:decoration-ink"
                >
                  Paste
                </button>
              </div>
              <p
                id="who-note"
                role={whoError || pasteNote ? 'alert' : undefined}
                className={`mt-2 font-body text-note ${whoError || pasteNote ? 'text-halt' : 'text-slate'}`}
              >
                {whoError ?? pasteNote ?? whoHint}
              </p>
            </>
          )}

          {known && knownName ? (
            <div className="mt-6 flex items-center gap-3 border-y border-hairline py-4">
              <Avatar initials={initialsFor(knownName)} tone={((existing.length % 3) + 1) as 1 | 2 | 3} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-strong text-prose text-ink">{knownName}</p>
                {person?.username ? (
                  <p className="truncate font-body text-note text-slate">@{person.username}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {known && !knownName ? (
            <>
              <label htmlFor="name" className="mt-6 block font-strong text-note text-slate">
                Name
              </label>
              <input
                id="name"
                value={typedName}
                onChange={(event) => setTypedName(event.target.value)}
                placeholder="Their full name"
                autoComplete="off"
                maxLength={NAME_MAX}
                disabled={saving}
                className={`mt-2 ${FIELD}`}
              />
            </>
          ) : null}

          {known ? (
            <>
              <label htmlFor="nickname" className="mt-6 block font-strong text-note text-slate">
                Nickname <span className="font-body text-mist">(optional)</span>
              </label>
              <input
                id="nickname"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="What you call them"
                autoComplete="off"
                maxLength={NAME_MAX}
                disabled={saving}
                className={`mt-2 ${FIELD}`}
              />
              <p className="mt-2 font-body text-note text-slate">If you add one, it is what you see when you pay them.</p>
            </>
          ) : null}
        </div>

        <p
          role={problem ? 'alert' : undefined}
          className={`mt-6 min-h-[20px] text-center font-body text-note ${problem ? 'text-halt' : 'text-slate'}`}
        >
          {problem ?? (paid || who.trim() ? blocker : '') ?? ''}
        </p>
        <button
          type="submit"
          disabled={Boolean(blocker) || saving}
          className="mt-2 flex h-14 w-full items-center justify-center gap-2.5 rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:opacity-60"
        >
          {saving ? <LogoLoader size={20} label="Saving" mono /> : null}
          {saving ? 'Saving' : next === 'send' ? 'Save and pay them' : 'Save'}
        </button>
      </form>
    </main>
  );
}
