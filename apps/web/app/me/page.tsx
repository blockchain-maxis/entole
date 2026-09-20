'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  USERNAME_MAX,
  normalizeUsername,
  validateFullName,
  validateUsername,
} from '@entole/core/profile';
import { useStore } from '@entole/core/store';

import { Avatar } from '@/components/Avatar';
import { Header } from '@/components/Header';
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

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function MePage() {
  const router = useRouter();
  const store = useStore();
  const { account, setAccount } = useAccount();
  const { preference, setPreference } = useTheme();
  const [locking, setLocking] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [credentialKnown, setCredentialKnown] = useState<boolean | null>(null);
  const [sessionFresh, setSessionFresh] = useState<boolean | null>(null);
  const profile = useProfile();
  const assistant = useAssistant();
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [touched, setTouched] = useState(false);
  const nameError = validateFullName(fullName);
  const usernameError = validateUsername(username);

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
    setEditing(true);
  }

  // Format is checked; uniqueness is not — there is no backend to check it
  // against yet (see `@entole/core/profile`).
  function saveProfile() {
    setTouched(true);
    if (nameError || usernameError || !account) return;
    const next = { fullName: fullName.trim(), username };
    storeProfile(next);
    setAccount({ ...account, displayName: next.fullName, username: next.username });
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
    window.location.href = `mailto:support@entole.to?subject=${encodeURIComponent(subject)}`;
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
              <p className="mt-3 max-w-full truncate font-strong text-title text-ink">{profile.fullName}</p>
              {profile.username ? (
                <p className="mt-1 max-w-full truncate font-body text-body-sm text-slate">@{profile.username}</p>
              ) : null}
              <p className="tabular mt-0.5 font-body text-label-sm text-mist">{profile.code}</p>
            </>
          ) : null}
        </div>

        <SectionLabel>Profile</SectionLabel>
        {editing ? (
          <form
            className="flex flex-col gap-2 rounded-row border border-line bg-card p-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveProfile();
            }}
          >
            <label htmlFor="profile-full-name" className="font-strong text-caption text-slate">
              Full name
            </label>
            <input
              id="profile-full-name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
              className="h-12 rounded-control border-[1.5px] border-indigo bg-card px-4 font-strong text-body text-ink outline-none"
            />
            {touched && nameError ? <p className="font-body text-caption text-slate">{nameError}</p> : null}
            <label htmlFor="profile-username" className="mt-2 font-strong text-caption text-slate">
              Username
            </label>
            <div className="flex h-12 items-center rounded-control border-[1.5px] border-line bg-card px-4 focus-within:border-indigo">
              <span className="font-strong text-body text-slate">@</span>
              <input
                id="profile-username"
                value={username}
                onChange={(event) => setUsername(normalizeUsername(event.target.value))}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={USERNAME_MAX}
                className="ml-1 min-w-0 flex-1 bg-transparent font-strong text-body text-ink outline-none"
              />
            </div>
            {touched && usernameError ? (
              <p className="font-body text-caption text-slate">{usernameError}</p>
            ) : null}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="flex h-12 flex-1 items-center justify-center rounded-control border border-line bg-card font-strong text-body text-ink transition-colors hover:border-mist"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={Boolean(nameError || usernameError)}
                className="flex h-12 flex-1 items-center justify-center rounded-control bg-ink font-strong text-body text-paper transition-colors hover:bg-indigo-deep disabled:opacity-60"
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
            label="Assistant"
            value={!assistant.enabled ? 'Off' : store.paused ? 'Paused' : 'On'}
            onClick={() => router.push('/assistant')}
          />
        </div>

        <SectionLabel>Security</SectionLabel>
        <div className="flex flex-col gap-2">
          <Row
            label="Passkey"
            value={credentialKnown === null ? 'Checking' : credentialKnown ? 'Registered in this browser' : 'Not registered'}
          />
          <Row label="Session" value={sessionFresh === null ? 'Checking' : sessionFresh ? 'Active' : 'Expired'} />
          <LinkRow
            label={resetting ? 'Signing out everywhere' : 'Sign out everywhere'}
            tone="danger"
            onClick={signOutEverywhere}
          />
        </div>

        <SectionLabel>Preferences</SectionLabel>
        <p className="mb-2.5 font-body text-label-sm text-slate">Theme</p>
        <div className="flex gap-2 rounded-control border border-line bg-card p-1.5">
          {THEME_OPTIONS.map((option) => {
            const active = preference === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={(event) => setPreference(option.value, { x: event.clientX, y: event.clientY })}
                className={`flex-1 rounded-chip py-2.5 font-strong text-label-sm transition-colors ${
                  active ? 'bg-indigo-wash text-ink' : 'text-mist hover:text-slate'
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
            className="flex items-center justify-between rounded-row border border-line bg-card px-4 py-3.5 transition-colors hover:border-mist"
          >
            <span className="font-body text-body-sm text-ink">Terms</span>
            <ChevronRight size={16} strokeWidth={1.5} className="text-mist" />
          </Link>
          <Link
            href="/legal/privacy"
            className="flex items-center justify-between rounded-row border border-line bg-card px-4 py-3.5 transition-colors hover:border-mist"
          >
            <span className="font-body text-body-sm text-ink">Privacy</span>
            <ChevronRight size={16} strokeWidth={1.5} className="text-mist" />
          </Link>
        </div>

        <button
          type="button"
          disabled={locking || store.status === 'loading'}
          onClick={lock}
          className="mt-8 flex h-14 w-full items-center justify-center rounded-control border border-line bg-card font-strong text-body-lg text-ink transition-colors hover:border-mist disabled:opacity-60"
        >
          {locking ? 'Locking' : 'Lock'}
        </button>
      </div>
    </main>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="pb-3 pt-7 font-strong text-body-lg text-ink">{children}</p>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-row border border-line bg-card px-4 py-3">
      <span className="font-body text-label-sm text-slate">{label}</span>
      <span className="tabular font-strong text-label text-ink">{value}</span>
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
      className="flex items-center justify-between rounded-row border border-line bg-card px-4 py-3.5 text-left transition-colors hover:border-mist"
    >
      <span className={`font-body text-body-sm ${tone === 'danger' ? 'text-halt' : 'text-ink'}`}>{label}</span>
      <span className="flex items-center gap-1.5">
        {value ? <span className="font-body text-body-sm text-slate">{value}</span> : null}
        <ChevronRight size={16} strokeWidth={1.5} className={tone === 'danger' ? 'text-halt' : 'text-mist'} />
      </span>
    </button>
  );
}
