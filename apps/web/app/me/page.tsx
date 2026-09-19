'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useStore } from '@entole/core/store';

import { Avatar } from '@/components/Avatar';
import { Header } from '@/components/Header';
import { useAccount } from '@/lib/account';
import { forgetEverything, hasStoredCredential, sessionIsFresh, signOut } from '@/lib/session';
import { useTheme, type ThemePreference } from '@/lib/theme';

/** First + last initial, uppercased. Falls back to "?" for an empty name. */
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

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
  const displayName = account?.displayName.trim() || 'there';

  useEffect(() => {
    function check() {
      setCredentialKnown(hasStoredCredential());
      setSessionFresh(sessionIsFresh());
    }
    check();
  }, []);

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
          <Avatar initials={initialsFor(displayName)} tone={1} />
          <p className="mt-3 font-strong text-title text-ink">{displayName}</p>
          <p className="mt-1 font-body text-label-sm text-slate">Lagos, Nigeria</p>
        </div>

        <SectionLabel>Account</SectionLabel>
        <div className="flex flex-col gap-2">
          <Row label="Allowances" value={`${store.allowances.length} active`} />
          <Row label="Corridor" value="NG ↔ US" />
          <Row label="Status" value={store.paused ? 'Paused' : 'Active'} />
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
                onClick={() => setPreference(option.value)}
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
  onClick,
  tone = 'default',
}: {
  label: string;
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
      <ChevronRight size={16} strokeWidth={1.5} className={tone === 'danger' ? 'text-halt' : 'text-mist'} />
    </button>
  );
}
