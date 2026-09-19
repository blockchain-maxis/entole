'use client';

import { ArrowDownLeft, Globe, Receipt, SendHorizontal, type LucideIcon } from 'lucide-react';
import Link from 'next/link';

import { useStore } from '@entole/core/store';

import { Avatar } from '@/components/Avatar';
import { Header } from '@/components/Header';
import { RowSkeleton } from '@/components/Skeleton';

const ACTIONS: { label: string; caption: string; icon: LucideIcon; href: string }[] = [
  { label: 'Send money', caption: 'To someone you know', icon: SendHorizontal, href: '/transfer/send' },
  { label: 'Request money', caption: 'Share a link or code', icon: ArrowDownLeft, href: '/receive' },
  { label: 'Pay a bill', caption: 'Power, airtime, TV', icon: Receipt, href: '/transfer/bill' },
  { label: 'Send abroad', caption: 'Pick a country first', icon: Globe, href: '/transfer/abroad' },
];

/** Everything you can do with money moving out or in, one tap away. */
export default function PayPage() {
  const store = useStore();
  const loading = store.status === 'loading';

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Pay" />

      <div className="flex-1 px-gutter pb-28">
        <div className="grid grid-cols-2 gap-3 pb-6 pt-1">
          {ACTIONS.map(({ label, caption, icon: Icon, href }) => (
            <Link
              key={label}
              href={href}
              className="rounded-card border border-line bg-card p-4 transition-colors hover:border-mist"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-pill bg-indigo-wash text-indigo">
                <Icon size={20} strokeWidth={1.5} aria-hidden />
              </span>
              <p className="mt-3 font-strong text-body text-ink">{label}</p>
              <p className="mt-0.5 font-body text-caption text-slate">{caption}</p>
            </Link>
          ))}
        </div>

        <p className="pb-3 font-heavy text-body-sm text-ink">Contacts</p>
        {loading ? (
          <div className="flex flex-col gap-2">
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {store.contacts.map((contact) => (
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
        )}
      </div>
    </main>
  );
}
