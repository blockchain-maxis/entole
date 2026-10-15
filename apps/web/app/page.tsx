'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { greetingFor } from '@entole/core/format';
import { toDollars } from '@entole/core/fx';
import { formatDollars } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { ActivityList } from '@/components/ActivityRow';
import { AllowanceCard } from '@/components/AllowanceCard';
import { AllowanceIntro } from '@/components/AllowanceIntro';
import { Figure } from '@/components/Amount';
import { AssistantBadge } from '@/components/Badge';
import { ButtonLink } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Header } from '@/components/Header';
import { OldAllowancesNotice } from '@/components/OldAllowancesNotice';
import { SectionHeading } from '@/components/SectionHeading';
import { ActivityRowSkeleton, AllowanceRowSkeleton, FigureSkeleton } from '@/components/Skeleton';
import { UsernameTakenNotice } from '@/components/UsernameTakenNotice';
import { useAssistant } from '@/lib/assistant';

/**
 * Home, as a page that has been written on. The balance is the one figure,
 * set large on the paper with no card around it. Under it, what the assistant
 * may do for you, each allowance a sentence in the assistant's blue. Then what
 * has happened, as ruled rows. Everything you do yourself is ink.
 */
export default function Home() {
  const store = useStore();
  // The device's own clock. The name is not repeated here: it is already in
  // the header, a line above.
  const greeting = greetingFor();
  const loading = store.status === 'loading';
  const failed = store.status === 'failed';

  // The assistant is a setting: nothing is announced until it is turned on.
  const router = useRouter();
  const assistant = useAssistant();
  const announced = useRef(false);
  const waiting = !loading && assistant.enabled && Boolean(store.proposal);
  useEffect(() => {
    if (!waiting || announced.current) return;
    announced.current = true;
    const timer = setTimeout(() => router.push('/assistant/action'), 1200);
    return () => clearTimeout(timer);
  }, [waiting, router]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col lg:max-w-[1080px]">
      <Header />

      <div className="flex-1 px-gutter pb-28 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:items-start lg:gap-x-20">
        <div className="min-w-0">
          {store.paused ? <PausedNotice onResume={() => void store.setPaused(false)} /> : null}
          <UsernameTakenNotice />
          {waiting ? (
            <Link
              href="/assistant/action"
              className="mb-2 mt-1 flex items-center gap-3 rounded-control bg-indigo-wash px-4 py-3.5 transition-colors active:translate-y-px"
            >
              <AssistantBadge />
              <span className="flex-1 font-strong text-ui text-ink">A payment is waiting. You can stop it.</span>
            </Link>
          ) : null}

          <h1 className="truncate pt-3 font-body text-ui text-slate">{greeting}</h1>

          {loading ? (
            <FigureSkeleton />
          ) : failed ? (
            // No figure at all: a zero here would read as the balance.
            <section className="pt-2">
              <p className="font-display text-subhead text-ink">We couldn&apos;t load your account</p>
              <p className="mt-1.5 text-pretty font-body text-ui text-slate">
                Your money is where you left it. This is only the screen failing to read it.
              </p>
              <button
                type="button"
                onClick={() => void store.refresh().catch(() => undefined)}
                className="mt-4 flex h-12 items-center justify-center rounded-control border border-line bg-card px-5 font-strong text-ui text-ink transition-colors hover:border-mist active:translate-y-px"
              >
                Try again
              </button>
            </section>
          ) : (
            <section aria-label="Your balance" className="pt-1.5">
              <Figure value={store.balance} />
              <p className="tabular mt-2 font-body text-ui text-slate">
                Available · about {formatDollars(toDollars(store.balance, store.rate))}
              </p>
            </section>
          )}

          <div className="mt-7 flex gap-2.5">
            <ButtonLink href="/transfer" label="Send" size="compact" />
            <ButtonLink href="/add-money" label="Add money" variant="secondary" size="compact" />
            <ButtonLink href="/receive" label="Receive" variant="secondary" size="compact" />
          </div>

          {failed ? null : (
            <>
              <SectionHeading
                title="Allowances"
                action={
                  !loading && store.allowances.length > 0
                    ? { label: 'New allowance', href: '/rules/new' }
                    : undefined
                }
              />
              <OldAllowancesNotice />
              {loading ? (
                <div className="divide-y divide-hairline border-y border-hairline">
                  <AllowanceRowSkeleton />
                  <AllowanceRowSkeleton />
                </div>
              ) : store.allowances.length === 0 ? (
                <AllowanceIntro />
              ) : (
                <>
                  <ul className="divide-y divide-hairline border-y border-hairline">
                    {store.allowances.map((allowance) => (
                      <AllowanceCard
                        key={allowance.id}
                        allowance={allowance}
                        recipientName={store.contact(allowance.recipientId)?.name ?? 'someone'}
                        resetsAt={allowance.resetsAt}
                        href={`/rules/${allowance.id}`}
                      />
                    ))}
                  </ul>
                  {assistant.enabled && !waiting ? (
                    <Link
                      href="/assistant"
                      className="mt-4 flex items-center gap-3 rounded-control bg-indigo-wash px-4 py-3.5 transition-colors active:translate-y-px"
                    >
                      <span className="flex-1 font-strong text-ui text-ink">Ask the assistant to pay someone</span>
                      <ArrowRight size={18} strokeWidth={1.75} aria-hidden className="flex-none text-indigo" />
                    </Link>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>

        {failed ? null : (
          <div className="min-w-0">
            <SectionHeading
              title="Activity"
              action={!loading && store.activity.length > 5 ? { label: 'All activity', href: '/activity' } : undefined}
            />
            {loading ? (
              <div>
                <ActivityRowSkeleton />
                <ActivityRowSkeleton />
                <ActivityRowSkeleton />
              </div>
            ) : store.activity.length === 0 ? (
              <EmptyState body="Nothing yet. A payment appears here the moment it is delivered." />
            ) : (
              <ActivityList entries={store.activity.slice(0, 5)} contactFor={store.contact} />
            )}
          </div>
        )}
      </div>
    </main>
  );
}

/** A paused assistant is said first, at the top, with the way back beside it. */
function PausedNotice({ onResume }: { onResume: () => void }) {
  return (
    <div className="mb-2 mt-1 flex items-center gap-3 rounded-control bg-halt-wash px-4 py-3">
      <span aria-hidden className="h-2.5 w-2.5 flex-none rounded-[2px] bg-halt" />
      <p className="flex-1 font-body text-ui text-ink">The assistant is paused. Your allowances are as you left them.</p>
      <button
        type="button"
        onClick={onResume}
        className="flex-none font-strong text-ui text-ink underline decoration-mist underline-offset-4 transition-colors hover:decoration-ink"
      >
        Resume
      </button>
    </div>
  );
}
