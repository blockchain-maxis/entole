'use client';

import { ChevronRight, Plus } from 'lucide-react';
import Link from 'next/link';

import { countryName } from '@entole/core/countries';
import { useStore } from '@entole/core/store';

import { Avatar } from '@/components/Avatar';
import { Header } from '@/components/Header';
import { ActivityRowSkeleton } from '@/components/Skeleton';

const ROW =
  '-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-control px-2 py-3 text-left transition-colors hover:bg-press';

/**
 * The people this account has saved: who can be paid again in two taps, and
 * who an allowance can be written for. Each opens to be renamed or removed.
 * They are listed by the name the person gave them, never by where their
 * money goes. Mirrors `apps/mobile/app/beneficiaries/index.tsx`.
 */
export default function BeneficiariesPage() {
  const store = useStore();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Beneficiaries" back="/me" />

      <div className="flex-1 px-gutter pb-28 pt-2">
        <p className="text-pretty font-body text-ui text-slate">
          People you pay often. Save someone by their username or phone number, and they are here when you pay or
          write an allowance.
        </p>

        <ul className="mt-5">
          <li>
            <Link href="/beneficiaries/new" className={ROW}>
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-pill bg-ink text-paper">
                <Plus size={20} strokeWidth={1.75} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-strong text-ui text-ink">Save someone</span>
                <span className="block font-body text-note text-slate">By their username or phone number</span>
              </span>
              <ChevronRight size={18} strokeWidth={1.5} aria-hidden className="flex-none text-mist" />
            </Link>
          </li>

          {store.status === 'loading' ? (
            <li className="border-t border-hairline">
              <ActivityRowSkeleton />
              <ActivityRowSkeleton />
              <ActivityRowSkeleton />
            </li>
          ) : store.status === 'failed' ? (
            <li className="border-t border-hairline py-4">
              <p className="font-body text-ui text-slate">We couldn&apos;t load your beneficiaries.</p>
              <button
                type="button"
                onClick={() => void store.refresh().catch(() => undefined)}
                className="mt-2 font-strong text-ui text-ink underline decoration-mist underline-offset-4 transition-colors hover:decoration-ink"
              >
                Try again
              </button>
            </li>
          ) : store.contacts.length === 0 ? (
            <li className="border-t border-hairline py-4">
              <p className="text-pretty font-body text-ui text-slate">
                Nobody saved yet. Save someone above, or from the receipt after you pay them.
              </p>
            </li>
          ) : (
            store.contacts.map((contact) => (
              <li key={contact.id} className="border-t border-hairline">
                <Link href={`/beneficiaries/${encodeURIComponent(contact.id)}`} className={ROW}>
                  <Avatar initials={contact.initials} tone={contact.tone} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-strong text-ui text-ink">{contact.name}</span>
                    {contact.place ? (
                      <span className="block truncate font-body text-note text-slate">
                        {countryName(contact.place) ?? contact.place}
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight size={18} strokeWidth={1.5} aria-hidden className="flex-none text-mist" />
                </Link>
              </li>
            ))
          )}
        </ul>
      </div>
    </main>
  );
}
