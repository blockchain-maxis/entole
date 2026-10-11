'use client';

import { useStore } from '@entole/core/store';

import { ActivityList } from '@/components/ActivityRow';
import { EmptyState } from '@/components/EmptyState';
import { Header } from '@/components/Header';
import { ActivityRowSkeleton } from '@/components/Skeleton';

/** Everything that has happened, newest first, as rows on paper. */
export default function ActivityPage() {
  const store = useStore();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Activity" back="/" />

      <div className="flex-1 px-gutter pb-28 pt-2">
        {store.status === 'loading' ? (
          <div>
            <ActivityRowSkeleton />
            <ActivityRowSkeleton />
            <ActivityRowSkeleton />
            <ActivityRowSkeleton />
          </div>
        ) : store.status === 'failed' ? (
          <div className="pt-2">
            <p className="font-body text-ui text-slate">We couldn&apos;t load your activity. Nothing about it has changed.</p>
            <button
              type="button"
              onClick={() => void store.refresh().catch(() => undefined)}
              className="mt-2 font-strong text-ui text-ink underline decoration-mist underline-offset-4 transition-colors hover:decoration-ink"
            >
              Try again
            </button>
          </div>
        ) : store.activity.length === 0 ? (
          <EmptyState body="Nothing yet. A payment appears here the moment it is delivered." />
        ) : (
          <ActivityList entries={store.activity} contactFor={store.contact} />
        )}
      </div>
    </main>
  );
}
