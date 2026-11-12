'use client';

import { useState } from 'react';

import { useMoneyPicture } from '@entole/core/money-picture-hook';
import type { StatementReading } from '@entole/core/near-client';

import { GlassSheet } from '@/components/GlassSheet';
import { Header } from '@/components/Header';
import { LogoLoader } from '@/components/LogoLoader';
import { MoneyPictureView } from '@/components/MoneyPictureView';
import { Skeleton } from '@/components/Skeleton';
import { ProofPanel, StatementImport } from '@/components/StatementImport';
import { periodWords, THIN_WORDS } from '@/lib/plan-words';

/**
 * Plan: the financial friend. It reads the person's own bank statements (in
 * sealed hardware, nothing kept there) beside their Entole activity, and says
 * what is safe to spend, where money goes, what leaks, whether something fits,
 * and what tax to expect. Every figure is theirs; a figure that cannot be
 * worked out honestly is not shown, and the page says why.
 * Mirrors `apps/mobile/app/(tabs)/plan.tsx`.
 */
export default function PlanPage() {
  const money = useMoneyPicture();
  /** The reading made on this visit, so every proof check can be listed. */
  const [reading, setReading] = useState<StatementReading | null>(null);
  const [forgetting, setForgetting] = useState(false);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Plan" />

      <div className="flex-1 px-gutter pb-28">
        {money.status === 'loading' ? (
          <PlanSkeleton />
        ) : money.status === 'empty' || !money.picture ? (
          <section aria-labelledby="plan-intro">
            <h2 id="plan-intro" className="pt-2 font-display text-heading text-ink">
              See what&apos;s safe to spend
            </h2>
            <p className="mt-2 max-w-[44ch] text-pretty font-body text-prose text-slate">
              Read a bank statement and Entole works out what you can spend today, where your money goes, the small
              payments that add up, and the tax to expect. Only from your own figures.
            </p>
            <p className="mb-6 mt-3 max-w-[44ch] text-pretty font-body text-note text-slate">
              The statement is read in sealed hardware that nobody can look inside, and the proof is checked before
              anything is sent. What is read is kept on this device only.
            </p>
            <StatementImport importStatement={money.importStatement} onRead={setReading} />
          </section>
        ) : (
          <>
            <p className="pt-1 font-body text-note text-slate">{periodWords(money.picture, money.latest)}</p>
            {money.picture.thin ? (
              <p className="mt-3 rounded-control bg-press px-4 py-3 text-pretty font-body text-ui text-ink">
                These figures cover under four weeks. {THIN_WORDS}
              </p>
            ) : null}

            {reading ? (
              <div className="mt-4">
                <ProofPanel
                  proof={reading.proof}
                  read={{
                    status: reading.reconciliation.status,
                    differenceMinor: reading.reconciliation.differenceMinor,
                    proven: reading.proof.proven,
                  }}
                />
              </div>
            ) : money.latest ? (
              <div className="mt-4">
                <ProofPanel proof={null} read={money.latest} />
              </div>
            ) : (
              <p className="mt-4 border-y border-hairline py-4 text-pretty font-body text-ui text-slate">
                This is from your Entole payments alone. Read a bank statement to see the rest of your money.
              </p>
            )}

            <MoneyPictureView picture={money.picture} />

            <section aria-label="Your statements" className="pt-12">
              <StatementImport importStatement={money.importStatement} onRead={setReading} again={Boolean(money.latest)} />
              {money.latest ? (
                <button
                  type="button"
                  onClick={() => setForgetting(true)}
                  className="mt-6 flex min-h-12 w-full items-center justify-between border-y border-hairline py-3.5 text-left font-body text-ui text-halt transition-colors hover:bg-press"
                >
                  Forget my statements
                </button>
              ) : null}
            </section>
          </>
        )}
      </div>

      {forgetting ? (
        <ForgetSheet
          onForget={async () => {
            await money.forget();
            setReading(null);
          }}
          onDismiss={() => setForgetting(false)}
        />
      ) : null}
    </main>
  );
}

function PlanSkeleton() {
  return (
    <div aria-hidden>
      <Skeleton className="mt-1 h-4 w-48" />
      <div className="mt-6 rounded-card bg-card p-5 shadow-raised">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-3 h-[60px] w-52" />
        <Skeleton className="mt-3 h-4 w-60" />
      </div>
      {[0, 1].map((section) => (
        <div key={section} className="pt-10">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="mt-4 h-8 w-40" />
          <Skeleton className="mt-4 h-4 w-full" />
          <Skeleton className="mt-3 h-4 w-full" />
        </div>
      ))}
    </div>
  );
}

/** Forgetting cannot be undone, so it asks first. */
function ForgetSheet({ onForget, onDismiss }: { onForget: () => Promise<void>; onDismiss: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function forget() {
    setBusy(true);
    setProblem(null);
    try {
      await onForget();
      onDismiss();
    } catch {
      setProblem("That didn't work. Your statements are still here. Try again.");
      setBusy(false);
    }
  }

  return (
    <GlassSheet label="Forget your statements" onDismiss={onDismiss} locked={busy}>
      <h2 className="pt-5 font-display text-subhead text-ink">Forget your statements?</h2>
      <p className="mt-2 text-pretty font-body text-ui text-slate">
        Every line read from your bank statements is removed from this device. Your Entole payments stay, and so does
        your money. You can read a statement again at any time.
      </p>
      {problem ? (
        <p role="alert" className="mt-3 font-body text-note text-halt">
          {problem}
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-2.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void forget()}
          className="flex h-14 w-full items-center justify-center gap-2.5 rounded-control bg-halt font-strong text-prose text-card transition-colors hover:bg-halt-deep active:translate-y-px disabled:opacity-60"
        >
          {busy ? <LogoLoader size={20} label="Forgetting" mono /> : null}
          {busy ? 'Forgetting' : 'Forget them'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDismiss}
          className="flex h-12 w-full items-center justify-center rounded-control border border-line bg-card font-strong text-ui text-ink transition-colors hover:border-mist active:translate-y-px disabled:opacity-60"
        >
          Keep them
        </button>
      </div>
    </GlassSheet>
  );
}
