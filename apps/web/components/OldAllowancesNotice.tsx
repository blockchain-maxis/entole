'use client';

import { useState } from 'react';

import { useStore } from '@entole/core/store';

import { LogoLoader } from './LogoLoader';

/**
 * Said once, after the allowance rules moved to their new home on the
 * network, where the undo window is held by the network itself. Allowances
 * written before that no longer pay and are shown stopped; what they could
 * still draw is cleared here, with one tap, and they are written again.
 */
export function OldAllowancesNotice() {
  const store = useStore();
  const [clearing, setClearing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!store.oldPolicyApproval) return null;

  async function clear() {
    if (clearing) return;
    setClearing(true);
    setProblem(null);
    try {
      await store.clearOldApprovals();
    } catch {
      setProblem("That didn't go through. Nothing changed. Try again.");
    } finally {
      setClearing(false);
    }
  }

  return (
    <section role="status" className="mb-4 border-y border-hairline py-4">
      <p className="font-strong text-ui text-ink">Allowances need writing again</p>
      <p className="mt-1 max-w-[60ch] text-pretty font-body text-note text-slate">
        The wait before the assistant pays is now kept by the network itself. Allowances written before that are
        stopped. Clear what they could still draw, then write the ones you want again.
      </p>
      {problem ? <p className="mt-2 font-body text-note text-halt">{problem}</p> : null}
      <button
        type="button"
        onClick={() => void clear()}
        disabled={clearing}
        className="mt-3 flex h-11 items-center gap-2.5 rounded-control bg-ink px-5 font-strong text-ui text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:opacity-60"
      >
        {clearing ? <LogoLoader size={18} label="Clearing" mono /> : null}
        {clearing ? 'Clearing' : 'Clear the old ones'}
      </button>
    </section>
  );
}
