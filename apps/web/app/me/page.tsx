'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useStore } from '@entole/core/store';

import { Avatar } from '@/components/Avatar';
import { Header } from '@/components/Header';
import { useAccount } from '@/lib/account';
import { signOut } from '@/lib/session';

export default function MePage() {
  const router = useRouter();
  const store = useStore();
  const { setAccount } = useAccount();
  const [locking, setLocking] = useState(false);

  function lock() {
    setLocking(true);
    signOut();
    setAccount(null);
    setLocking(false);
    router.push('/');
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Me" />

      <div className="flex-1 px-gutter pb-28">
        <div className="flex flex-col items-center py-6">
          <Avatar initials="AE" tone={1} />
          <p className="mt-3 font-strong text-title text-ink">Adaeze</p>
          <p className="mt-1 font-body text-label-sm text-slate">Lagos, Nigeria</p>
        </div>

        <p className="pb-3 pt-[10px] font-strong text-body-lg text-ink">Account</p>
        <div className="flex flex-col gap-2">
          <Row label="Allowances" value={`${store.allowances.length} active`} />
          <Row label="Corridor" value="NG ↔ US" />
          <Row label="Status" value={store.paused ? 'Paused' : 'Active'} />
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-row border border-line bg-card px-4 py-3">
      <span className="font-body text-label-sm text-slate">{label}</span>
      <span className="tabular font-strong text-label text-ink">{value}</span>
    </div>
  );
}
