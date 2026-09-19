'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { corridorsFor } from '@entole/core/pay-hub';
import { useStore } from '@entole/core/store';

import { Avatar } from '@/components/Avatar';
import { Header } from '@/components/Header';
import { RowSkeleton } from '@/components/Skeleton';

/** Pick the country first, then the person — the send flow itself is unchanged. */
export default function SendAbroadPage() {
  const store = useStore();
  const loading = store.status === 'loading';

  const corridors = useMemo(() => corridorsFor(store.contacts), [store.contacts]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = corridors.find((corridor) => corridor.id === selectedId) ?? corridors[0];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Send abroad" back="/transfer" />

      <div className="flex-1 px-gutter pb-28">
        {loading ? (
          <div className="flex flex-col gap-2">
            <RowSkeleton />
            <RowSkeleton />
          </div>
        ) : selected ? (
          <>
            <p className="pb-3 font-heavy text-body-sm text-ink">Send to</p>
            <div className="flex flex-wrap gap-2 pb-6">
              {corridors.map((corridor) => {
                const active = corridor.id === selected.id;
                return (
                  <button
                    key={corridor.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelectedId(corridor.id)}
                    className={`rounded-pill border px-4 py-2.5 font-strong text-label transition-colors ${
                      active ? 'border-indigo bg-indigo-wash text-indigo' : 'border-line bg-card text-ink hover:border-mist'
                    }`}
                  >
                    Nigeria → {corridor.label}
                  </button>
                );
              })}
            </div>

            <p className="pb-3 font-heavy text-body-sm text-ink">Who are you sending to?</p>
            <ul className="flex flex-col gap-2">
              {selected.contacts.map((contact) => (
                <li key={contact.id}>
                  <Link
                    href={`/transfer/send?contact=${encodeURIComponent(contact.id)}`}
                    className="flex w-full items-center gap-3 rounded-row border border-line bg-card px-3.5 py-3 text-left transition-colors hover:border-mist"
                  >
                    <Avatar initials={contact.initials} tone={contact.tone} />
                    <div className="min-w-0 flex-1">
                      <p className="font-strong text-body text-ink">{contact.name}</p>
                      {contact.place ? <p className="font-body text-caption text-slate">{contact.place}</p> : null}
                    </div>
                    <span className="font-strong text-caption-sm text-indigo">Send</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="rounded-control border border-line bg-card px-4 py-3.5">
            <p className="font-strong text-body-sm text-ink">No countries yet</p>
            <p className="mt-1 font-body text-label-sm text-slate">
              Once you have a contact abroad, their country shows up here.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
