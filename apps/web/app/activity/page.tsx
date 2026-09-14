'use client';

import { useStore } from '@entole/core/store';

import { ActivityRow } from '@/components/ActivityRow';
import { Header } from '@/components/Header';
import { RowSkeleton } from '@/components/Skeleton';

export default function ActivityPage() {
  const store = useStore();
  const loading = store.status === 'loading';

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Activity" back="/" />

      <ul className="flex flex-1 flex-col gap-2 px-gutter pb-8 pt-2">
        {loading ? (
          <>
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </>
        ) : (
          store.activity.map((entry) => (
            <ActivityRow key={entry.id} entry={entry} contact={store.contact(entry.contactId)} />
          ))
        )}
      </ul>
    </main>
  );
}
