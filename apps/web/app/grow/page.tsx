'use client';

import { Header } from '@/components/Header';
import { SavingsCard, StocksRow } from '@/components/SavingsCard';

/**
 * The Grow page, kept so the links into it still open. Its content now lives
 * on Money, beside the balance and the pockets; this is the same savings card
 * and stocks row, on their own. Mirrors `apps/mobile/app/(tabs)/grow.tsx`.
 */
export default function GrowHubPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Grow" back="/money" />

      <div className="flex flex-1 flex-col px-gutter pb-28">
        <SavingsCard />
        <StocksRow />
      </div>
    </main>
  );
}
