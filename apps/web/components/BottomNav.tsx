'use client';

import { Briefcase, House, SendHorizontal, Sprout, User, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { BrandGlyph } from './Header';

/** Same 5 tabs, same order, same icons as `apps/mobile/app/(tabs)/_layout.tsx`. */
const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'Home', icon: House },
  { href: '/transfer', label: 'Pay', icon: SendHorizontal },
  { href: '/business', label: 'Business', icon: Briefcase },
  { href: '/grow', label: 'Grow', icon: Sprout },
  { href: '/me', label: 'Me', icon: User },
];

/** Screens that are one decision with its own button at the bottom. The bar
 * steps aside there; drawn over them it covered that button. */
const BARE = new Set(['/assistant/action', '/offline']);

/**
 * On a phone, a floating pill bar matching mobile's tab-bar spec: card
 * background, the floating shadow token, inset from the screen edges, a pill
 * behind the active icon and label. The bar is a capsule round those
 * capsules, so the outer curve follows the inner one.
 *
 * From 1024px the same five places run along the top instead, with the mark
 * beside them: a bar across the bottom of a wide window is a phone drawn on a
 * desktop. `AuthGate` leaves room for it above every page.
 */
export function BottomNav() {
  const pathname = usePathname();
  if (BARE.has(pathname)) return null;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-4 bottom-[max(12px,env(safe-area-inset-bottom))] z-20 mx-auto flex h-16 w-[calc(100%-2rem)] max-w-[528px] items-center justify-evenly rounded-pill bg-card px-1.5 shadow-floating lg:inset-x-0 lg:bottom-auto lg:top-0 lg:h-[68px] lg:w-full lg:max-w-none lg:justify-start lg:gap-1 lg:rounded-none lg:border-b lg:border-hairline lg:bg-paper lg:px-8 lg:shadow-none"
    >
      <Link href="/" aria-label="Entole, home" className="mr-8 hidden flex-none items-center gap-2.5 lg:flex">
        <BrandGlyph size={24} />
        <span className="font-display text-subhead text-ink">Entole</span>
      </Link>
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            className={`flex h-[52px] flex-1 flex-col items-center justify-center gap-1 rounded-pill transition-colors lg:h-10 lg:flex-none lg:flex-row lg:gap-2 lg:px-4 ${
              active ? 'bg-press text-ink' : 'text-slate hover:text-ink'
            }`}
          >
            <Icon size={20} strokeWidth={1.5} aria-hidden />
            <span className="font-strong text-note">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
