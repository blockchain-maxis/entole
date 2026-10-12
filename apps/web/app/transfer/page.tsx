'use client';

import { ArrowDownLeft, ChevronRight, Globe, Plus, Receipt, type LucideIcon } from 'lucide-react';
import Link from 'next/link';

import { useStore } from '@entole/core/store';

import { Avatar } from '@/components/Avatar';
import { Header } from '@/components/Header';
import { SectionHeading } from '@/components/SectionHeading';
import { ActivityRowSkeleton } from '@/components/Skeleton';

const OTHER_WAYS: { label: string; caption: string; icon: LucideIcon; href: string }[] = [
  { label: 'Get paid', caption: 'Share your payment link', icon: ArrowDownLeft, href: '/receive' },
  { label: 'Pay a bill', caption: 'Power, airtime, TV', icon: Receipt, href: '/transfer/bill' },
  { label: 'Send abroad', caption: 'Pick a country first', icon: Globe, href: '/transfer/abroad' },
];

const ROW =
  '-mx-3 flex items-center gap-3 rounded-control px-3 py-3 text-left transition-colors hover:bg-press active:translate-y-px';

/**
 * Paying starts from people. The beneficiaries already saved lead; someone new
 * comes in by their payment code or link, one row above them. Everything else
 * money can do sits under that, as plain rows.
 */
export default function PayPage() {
  const store = useStore();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Pay" />

      <div className="flex-1 px-gutter pb-28">
        <h2 className="pt-2 font-display text-heading text-ink">Who are you paying?</h2>

        <ul className="mt-4">
          <li>
            <Link href="/transfer/send" className={ROW}>
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-pill bg-ink text-paper">
                <Plus size={20} strokeWidth={1.75} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-strong text-ui text-ink">Someone new</span>
                <span className="block font-body text-note text-slate">With their username, number or link</span>
              </span>
              <ChevronRight size={18} strokeWidth={1.5} aria-hidden className="flex-none text-mist" />
            </Link>
          </li>

          {store.status === 'loading' ? (
            <li className="border-t border-hairline">
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
                No beneficiaries yet. After you pay someone you can save them from the receipt, and they appear
                here.
              </p>
            </li>
          ) : (
            store.contacts.map((contact) => (
              <li key={contact.id} className="border-t border-hairline">
                <Link href={`/transfer/send?contact=${encodeURIComponent(contact.id)}`} className={ROW}>
                  <Avatar initials={contact.initials} tone={contact.tone} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-strong text-ui text-ink">{contact.name}</span>
                    {contact.place ? (
                      <span className="block truncate font-body text-note text-slate">{contact.place}</span>
                    ) : null}
                  </span>
                  <ChevronRight size={18} strokeWidth={1.5} aria-hidden className="flex-none text-mist" />
                </Link>
              </li>
            ))
          )}
        </ul>

        <SectionHeading title="Other ways" />
        <ul>
          {OTHER_WAYS.map(({ label, caption, icon: Icon, href }, index) => (
            <li key={label} className={index > 0 ? 'border-t border-hairline' : ''}>
              <Link href={href} className={ROW}>
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-pill bg-press text-ink">
                  <Icon size={20} strokeWidth={1.5} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-strong text-ui text-ink">{label}</span>
                  <span className="block font-body text-note text-slate">{caption}</span>
                </span>
                <ChevronRight size={18} strokeWidth={1.5} aria-hidden className="flex-none text-mist" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
