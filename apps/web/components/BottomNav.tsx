'use client';

import { Briefcase, House, SendHorizontal, Sprout, User, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Same 5 tabs, same order, same icons as `apps/mobile/app/(tabs)/_layout.tsx`. */
const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'Home', icon: House },
  { href: '/transfer', label: 'Transfer', icon: SendHorizontal },
  { href: '/business', label: 'Business', icon: Briefcase },
  { href: '/grow', label: 'Grow', icon: Sprout },
  { href: '/me', label: 'Me', icon: User },
];

/**
 * A floating pill bar, matching mobile's Phase 2 tab-bar spec exactly:
 * card background, panel radius, the floating shadow token, inset from the
 * screen edges rather than edge-to-edge, an indigo-wash pill behind the
 * active icon+label instead of an underline indicator.
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-4 bottom-[max(12px,env(safe-area-inset-bottom))] z-20 mx-auto flex h-16 w-[calc(100%-2rem)] max-w-[528px] items-center justify-evenly rounded-panel bg-card px-1.5 shadow-floating"
    >
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            className={`flex h-[52px] flex-1 flex-col items-center justify-center gap-1 rounded-pill transition-colors ${
              active ? 'bg-indigo-wash text-indigo' : 'text-mist'
            }`}
          >
            <Icon size={20} strokeWidth={1.5} aria-hidden />
            <span className="font-strong text-caption-sm">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
