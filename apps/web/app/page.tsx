'use client';

import Link from 'next/link';

import { greetingFor } from '@entole/core/format';
import { toDollars } from '@entole/core/fx';
import { formatDollars } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { ActivityRow } from '@/components/ActivityRow';
import { AllowanceCard } from '@/components/AllowanceCard';
import { Amount } from '@/components/Amount';
import { ButtonLink } from '@/components/Button';
import { Header } from '@/components/Header';
import { useAccount } from '@/lib/account';
import { PauseIntro } from '@/components/PauseIntro';
import {
  AllowanceCardSkeleton,
  BalanceSkeleton,
  RowSkeleton,
} from '@/components/Skeleton';

export default function Home() {
  const store = useStore();
  const { account } = useAccount();
  // The device's own clock and the person's own full name. No name yet means the
  // greeting stands alone — nothing is invented to fill the gap.
  const fullName = account?.displayName.trim() ?? '';
  const greeting = fullName ? `${greetingFor()}, ${fullName}` : greetingFor();
  const loading = store.status === 'loading';

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header />

      <div className="flex-1 px-gutter pb-28">
        <h1 className="truncate pb-4 pt-2 font-strong text-headline text-ink">{greeting}</h1>
        <PauseIntro />
        {loading ? (
          <BalanceSkeleton />
        ) : (
          <section className="rounded-panel bg-card p-6 shadow-raised">
            <p className="font-strong text-label-sm text-mist">Available balance</p>
            <div className="mt-2.5">
              <Amount value={store.balance} />
            </div>
            <p className="tabular mt-3 font-body text-body-sm text-slate">
              ≈ {formatDollars(toDollars(store.balance, store.rate))}
            </p>
          </section>
        )}

        <div className="mt-5 flex gap-2.5">
          <ButtonLink href="/transfer" label="Send" />
          <ButtonLink href="/receive" label="Deposit" variant="secondary" />
          <ButtonLink href="/business" label="Business" variant="secondary" />
        </div>

        <SectionHeading title="Allowances" action={{ label: 'Manage', href: '/rules/new' }} />

        <ul className="flex flex-col gap-2.5">
          {loading ? (
            <>
              <AllowanceCardSkeleton />
              <AllowanceCardSkeleton />
              <AllowanceCardSkeleton />
            </>
          ) : (
            store.allowances.map((allowance) => (
              <Link key={allowance.id} href={`/rules/${allowance.id}`} className="block">
                <AllowanceCard allowance={allowance} resetsAt={allowance.resetsAt} />
              </Link>
            ))
          )}
        </ul>

        <SectionHeading title="Recent activity" action={{ label: 'All', href: '/activity' }} />

        <ul className="flex flex-col gap-2">
          {loading ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : (
            store.activity
              .slice(0, 5)
              .map((entry) => (
                <ActivityRow key={entry.id} entry={entry} contact={store.contact(entry.contactId)} />
              ))
          )}
        </ul>

        {store.paused ? <PausedBanner onResume={() => void store.setPaused(false)} /> : null}
      </div>
    </main>
  );
}

function SectionHeading({
  title,
  action,
}: {
  title: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex items-baseline justify-between pb-3 pt-[30px] first:pt-0">
      <h2 className="font-strong text-body-lg text-ink">{title}</h2>
      {action ? (
        <a href={action.href} className="font-strong text-label text-indigo hover:underline">
          {action.label}
        </a>
      ) : null}
    </div>
  );
}

function PausedBanner({ onResume }: { onResume: () => void }) {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-control bg-ink px-4 py-3.5">
      <span aria-hidden className="h-2.5 w-2.5 flex-none rounded-[2px] bg-halt" />
      <p className="flex-1 font-body text-label text-paper">
        All allowances paused. Nothing is lost.
      </p>
      <button type="button" onClick={onResume} className="font-strong text-label text-card underline">
        Resume
      </button>
    </div>
  );
}
