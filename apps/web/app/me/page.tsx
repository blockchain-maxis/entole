'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import {
  USERNAME_MAX,
  initialsFor,
  normalizeUsername,
  validateFullName,
  validateUsername,
} from '@entole/core/profile';
import { useBackend } from '@entole/core/backend';
import { DirectoryError } from '@entole/core/directory';
import { useStore } from '@entole/core/store';
import { USERNAME_TAKEN, useUsernameCheck } from '@entole/core/username-check';

import { Avatar } from '@/components/Avatar';
import { Header } from '@/components/Header';
import { UsernameTakenNotice } from '@/components/UsernameTakenNotice';
import { useAccount } from '@/lib/account';
import { useAssistant } from '@/lib/assistant';
import { useProfile } from '@/lib/profile';
import {
  forgetEverything,
  hasStoredCredential,
  sessionIsFresh,
  signOut,
  storeProfile,
} from '@/lib/session';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { recordUsernameClaim, useUsernameClaim } from '@/lib/username-claim';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function MePage() {
  // `useSearchParams` needs a boundary above it to be prerendered.
  return (
    <Suspense fallback={null}>
      <Me />
    </Suspense>
  );
}

function Me() {
  const router = useRouter();
  const backend = useBackend();
  const claim = useUsernameClaim();
  const wantsEdit = useSearchParams().get('edit') === '1';
  const store = useStore();
  const { account, setAccount } = useAccount();
  const { preference, setPreference } = useTheme();
  const [locking, setLocking] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [credentialKnown, setCredentialKnown] = useState<boolean | null>(null);
  const [sessionFresh, setSessionFresh] = useState<boolean | null>(null);
  const profile = useProfile();
  const assistant = useAssistant();
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  /** A name the directory refused when it was claimed. */
  const [refused, setRefused] = useState<string | null>(null);
  const usernameCheck = useUsernameCheck('', username, account?.owner.address);
  const usernameTaken = editing && (usernameCheck === 'taken' || refused === username);
  const nameError = validateFullName(fullName);
  const usernameError = validateUsername(username) ?? (usernameTaken ? USERNAME_TAKEN : null);

  useEffect(() => {
    function check() {
      setCredentialKnown(hasStoredCredential());
      setSessionFresh(sessionIsFresh());
    }
    check();
  }, []);

  function startEditing() {
    setFullName(account?.displayName ?? '');
    setUsername(account?.username ?? '');
    setTouched(false);
    setSaveProblem(null);
    setEditing(true);
  }

  // Sent here to choose again because the username turned out to be someone
  // else's: open the form instead of leaving them to find it.
  const sentToEdit = wantsEdit && claim === 'taken' && Boolean(account);
  useEffect(() => {
    if (!sentToEdit || !account) return;
    const timer = setTimeout(() => {
      setFullName(account.displayName);
      setUsername(account.username);
      setEditing(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [sentToEdit, account]);

  // A username is one person's. Saving claims it in the directory first: if
  // someone else holds it, nothing is saved. Any other failure keeps the
  // change on this device and says that other people cannot see it yet.
  async function saveProfile() {
    setTouched(true);
    if (nameError || usernameError || usernameCheck === 'checking' || !account || saving) return;
    const next = { fullName: fullName.trim(), username };
    setSaving(true);
    setSaveProblem(null);
    try {
      await backend.directory.claim({
        address: account.owner.address,
        name: next.fullName,
        initials: initialsFor(next.fullName),
        tone: 1,
        username,
      });
      recordUsernameClaim(account.owner.address, username);
    } catch (error) {
      if (error instanceof DirectoryError && error.code === 'username_taken') {
        setRefused(username);
        setSaving(false);
        return;
      }
      setSaveProblem(
        error instanceof DirectoryError ? error.message : "Saved here, but other people can't see the change yet.",
      );
    }
    storeProfile(next);
    setAccount({ ...account, displayName: next.fullName, username: next.username });
    setSaving(false);
    setEditing(false);
  }

  function lock() {
    setLocking(true);
    signOut();
    setAccount(null);
    setLocking(false);
    router.push('/');
  }

  function signOutEverywhere() {
    setResetting(true);
    forgetEverything();
    setAccount(null);
    setResetting(false);
    router.push('/');
  }

  function contactSupport(subject: string) {
    window.location.href = `mailto:support@entole.pro?subject=${encodeURIComponent(subject)}`;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Me" />

      <div className="flex-1 px-gutter pb-28">
        <div className="flex flex-col items-center py-4">
          {profile ? (
            <>
              {/* TODO(photo): initials until a picture can be uploaded. */}
              <Avatar initials={profile.initials} tone={1} />
              <p className="mt-3 max-w-full truncate font-display text-subhead text-ink">{profile.fullName}</p>
              {profile.username ? (
                <p className="mt-1 max-w-full truncate font-body text-ui text-slate">@{profile.username}</p>
              ) : null}
            </>
          ) : null}
        </div>

        <SectionLabel>Profile</SectionLabel>
        {editing ? null : <UsernameTakenNotice editHref={null} />}
        {saveProblem && !editing ? <p className="mb-2 font-body text-note text-slate">{saveProblem}</p> : null}
        {editing ? (
          <form
            className="flex flex-col gap-2 rounded-card border border-line bg-card p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void saveProfile();
            }}
          >
            <label htmlFor="profile-full-name" className="font-strong text-note text-slate">
              Full name
            </label>
            <input
              id="profile-full-name"
              spellCheck={false}
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
              className="h-12 rounded-control border-[1.5px] border-ink bg-card px-4 font-strong text-ui text-ink outline-none"
            />
            {touched && nameError ? <p className="font-body text-note text-slate">{nameError}</p> : null}
            <label htmlFor="profile-username" className="mt-2 font-strong text-note text-slate">
              Username
            </label>
            <div className="flex h-12 items-center rounded-control border-[1.5px] border-line bg-card px-4 focus-within:border-ink">
              <span className="font-strong text-ui text-slate">@</span>
              <input
                id="profile-username"
                value={username}
                onChange={(event) => setUsername(normalizeUsername(event.target.value))}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={USERNAME_MAX}
                className="ml-1 min-w-0 flex-1 bg-transparent font-strong text-ui text-ink outline-none"
              />
            </div>
            {usernameTaken ? (
              <p role="alert" className="font-body text-note text-halt">
                {USERNAME_TAKEN}
              </p>
            ) : touched && usernameError ? (
              <p className="font-body text-note text-slate">{usernameError}</p>
            ) : null}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="flex h-12 flex-1 items-center justify-center rounded-control border border-line bg-card font-strong text-ui text-ink transition-colors hover:border-mist"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={Boolean(nameError || usernameError) || usernameCheck === 'checking' || saving}
                className="flex h-12 flex-1 items-center justify-center rounded-control bg-ink font-strong text-ui text-paper transition-colors hover:bg-ink/85 disabled:opacity-60"
              >
                Save
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-2">
            <LinkRow label="Edit profile" onClick={startEditing} />
          </div>
        )}

        <SectionLabel>Account</SectionLabel>
        <div className="flex flex-col gap-2">
          <Row label="Allowances" value={`${store.allowances.length} active`} />
          <LinkRow
            label="Beneficiaries"
            value={store.status === 'ready' ? `${store.contacts.length} saved` : undefined}
            onClick={() => router.push('/beneficiaries')}
          />
          <LinkRow
            label="Assistant"
            value={!assistant.enabled && !assistant.talking ? 'Off' : store.paused ? 'Paused' : 'On'}
            onClick={() => router.push('/assistant')}
          />
          <LinkRow label="Connections" onClick={() => router.push('/connections')} />
        </div>

        <SectionLabel>Security</SectionLabel>
        <div className="flex flex-col gap-2">
          <Row
            label="Passkey"
            value={credentialKnown === null ? 'Checking' : credentialKnown ? 'Registered in this browser' : 'Not registered'}
          />
          <Row label="Session" value={sessionFresh === null ? 'Checking' : sessionFresh ? 'Active' : 'Expired'} />
          {confirmingReset ? (
            <div className="rounded-card border border-halt bg-halt-wash px-4 py-3.5">
              <p className="font-strong text-ui text-ink">Sign out and forget this browser?</p>
              <p className="mt-1 text-pretty font-body text-note text-slate">
                This browser forgets your name and which passkey to ask for. Your account and your money are not
                touched. To come back, choose &ldquo;I already have an account&rdquo;.
              </p>
              <div className="mt-3 flex gap-2.5">
                <button
                  type="button"
                  disabled={resetting}
                  onClick={signOutEverywhere}
                  className="flex h-11 flex-1 items-center justify-center rounded-control bg-halt font-strong text-ui text-card transition-colors hover:bg-halt-deep active:translate-y-px disabled:opacity-60"
                >
                  {resetting ? 'Signing out' : 'Sign out'}
                </button>
                <button
                  type="button"
                  disabled={resetting}
                  onClick={() => setConfirmingReset(false)}
                  className="flex h-11 flex-1 items-center justify-center rounded-control border border-line bg-card font-strong text-ui text-ink transition-colors hover:border-mist active:translate-y-px disabled:opacity-60"
                >
                  Stay signed in
                </button>
              </div>
            </div>
          ) : (
            <LinkRow label="Sign out and forget this browser" tone="danger" onClick={() => setConfirmingReset(true)} />
          )}
        </div>

        <SectionLabel>Preferences</SectionLabel>
        <p className="mb-2.5 font-body text-note text-slate">Theme</p>
        <div className="flex gap-2 rounded-control border border-line bg-card p-1.5">
          {THEME_OPTIONS.map((option) => {
            const active = preference === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={(event) => setPreference(option.value, { x: event.clientX, y: event.clientY })}
                className={`flex-1 rounded-control py-2.5 font-strong text-note transition-colors ${
                  active ? 'bg-ink text-paper' : 'text-slate hover:text-ink'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <SectionLabel>Support</SectionLabel>
        <div className="flex flex-col gap-2">
          <LinkRow label="Help center" onClick={() => contactSupport('Help')} />
          <LinkRow label="Send feedback" onClick={() => contactSupport('Feedback')} />
        </div>

        <SectionLabel>Legal</SectionLabel>
        <div className="flex flex-col gap-2">
          <Link
            href="/legal/terms"
            className="flex items-center justify-between border-b border-hairline py-3.5 transition-colors hover:bg-press"
          >
            <span className="font-body text-ui text-ink">Terms</span>
            <ChevronRight size={16} strokeWidth={1.5} className="text-mist" />
          </Link>
          <Link
            href="/legal/privacy"
            className="flex items-center justify-between border-b border-hairline py-3.5 transition-colors hover:bg-press"
          >
            <span className="font-body text-ui text-ink">Privacy</span>
            <ChevronRight size={16} strokeWidth={1.5} className="text-mist" />
          </Link>
        </div>

        <button
          type="button"
          disabled={locking || store.status === 'loading'}
          onClick={lock}
          className="mt-8 flex h-14 w-full items-center justify-center rounded-control border border-line bg-card font-strong text-prose text-ink transition-colors hover:border-mist disabled:opacity-60"
        >
          {locking ? 'Locking' : 'Lock'}
        </button>
      </div>
    </main>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="pb-3 pt-8 font-display text-subhead text-ink">{children}</h2>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-hairline py-3">
      <span className="font-body text-note text-slate">{label}</span>
      <span className="tabular font-strong text-ui text-ink">{value}</span>
    </div>
  );
}

function LinkRow({
  label,
  value,
  onClick,
  tone = 'default',
}: {
  label: string;
  value?: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between border-b border-hairline py-3.5 text-left transition-colors hover:bg-press"
    >
      <span className={`font-body text-ui ${tone === 'danger' ? 'text-halt' : 'text-ink'}`}>{label}</span>
      <span className="flex items-center gap-1.5">
        {value ? <span className="font-body text-ui text-slate">{value}</span> : null}
        <ChevronRight size={16} strokeWidth={1.5} className={tone === 'danger' ? 'text-halt' : 'text-mist'} />
      </span>
    </button>
  );
}
