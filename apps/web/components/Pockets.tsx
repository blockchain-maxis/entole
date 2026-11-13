'use client';

import { ArrowDownUp, Check, ChevronRight, Plus } from 'lucide-react';
import { useCallback, useState } from 'react';

import { EMPTY_ENTRY, entryDisplay, entryFromMinor, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import { useBackend } from '@entole/core/backend';
import { toNaira } from '@entole/core/fx';
import {
  MOVEMENT_WORDS,
  PAY_IN_SOURCES,
  POCKETS,
  formatPocketAmount,
  payInSourceLabel,
  type MovementState,
  type PayInSource,
  type PocketId,
} from '@entole/core/intents-pockets';
import { cents, formatNaira, kobo } from '@entole/core/money';
import type { PocketView, PreparedPocketSwap } from '@entole/core/near-client';
import type { PocketsOpening } from '@entole/core/pockets-link';
import { useStore } from '@entole/core/store';

import { GlassSheet } from './GlassSheet';
import { Keypad } from './Keypad';
import { LogoLoader } from './LogoLoader';
import { ScanCode } from './ScanCode';
import { Skeleton } from './Skeleton';
import { FINAL_STATES, useMovementState } from '@/lib/movement';
import { messageOf, signOf, usePockets } from '@/lib/pockets';

/**
 * Pockets: money held in dollars, euros and pounds beside the naira balance.
 * Each row is the amount in its own currency and about what it is in naira at
 * today's rate. Adding comes from an app the person already uses, by a scan
 * code; changing currency is quoted first and confirmed with the passkey, and
 * shows each real step until it has arrived.
 */

const PRIMARY =
  'flex h-14 w-full items-center justify-center gap-2.5 rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60';
const SECONDARY =
  'flex h-12 w-full items-center justify-center gap-2 whitespace-nowrap rounded-control border border-line bg-card px-3 font-strong text-ui text-ink transition-colors hover:border-mist active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60';
const ROW =
  'flex min-h-14 w-full items-center gap-3 border-b border-hairline py-3.5 text-left transition-colors hover:bg-press active:translate-y-px';

const words = (id: PocketId) => POCKETS.find((pocket) => pocket.id === id)!.words;

export function PocketsSection({ opening = null }: { opening?: PocketsOpening | null }) {
  const pockets = usePockets();
  const [sheet, setSheet] = useState<'add' | 'change' | null>(opening?.sheet ?? null);
  /** A pocket to add to, picked already: from a link, or from "add dollars first" on Change currency. */
  const [addPocket, setAddPocket] = useState<PocketId | null>(opening?.sheet === 'add' ? (opening.pocket ?? null) : null);
  const ready = pockets.status === 'ready';
  const { reload } = pockets;

  return (
    <section aria-labelledby="pockets-title">
      <div className="flex items-baseline justify-between gap-4 pb-1 pt-10">
        <h2 id="pockets-title" className="font-display text-subhead text-ink">
          Pockets
        </h2>
      </div>
      <p className="pb-3 text-pretty font-body text-note text-slate">Money kept in other currencies, ready to send or change.</p>

      {pockets.status === 'loading' ? (
        <div className="border-t border-hairline">
          {POCKETS.map((pocket) => (
            <div key={pocket.id} className="flex items-center justify-between border-b border-hairline py-4">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </div>
      ) : pockets.status === 'failed' ? (
        <div className="border-y border-hairline py-4">
          <p className="text-pretty font-body text-ui text-slate">
            We couldn&apos;t read your pockets. {pockets.message}
          </p>
          <button
            type="button"
            onClick={pockets.reload}
            className="mt-2 min-h-11 font-strong text-ui text-ink underline decoration-mist underline-offset-4 transition-colors hover:decoration-ink"
          >
            Try again
          </button>
        </div>
      ) : (
        <ul className="border-t border-hairline">
          {pockets.pockets.map((pocket) => (
            <PocketRow key={pocket.id} pocket={pocket} />
          ))}
        </ul>
      )}

      {/* One above the other on a phone, side by side once both labels fit on one line. */}
      <div className="mt-4 grid grid-cols-1 gap-2.5 min-[480px]:grid-cols-2">
        <button
          type="button"
          disabled={!ready}
          onClick={() => {
            setAddPocket(null);
            setSheet('add');
          }}
          className={SECONDARY}
        >
          <Plus size={18} strokeWidth={1.75} aria-hidden />
          Add to a pocket
        </button>
        <button type="button" disabled={!ready} onClick={() => setSheet('change')} className={SECONDARY}>
          <ArrowDownUp size={18} strokeWidth={1.75} aria-hidden />
          Change currency
        </button>
      </div>

      {sheet === 'add' ? (
        <AddToPocketSheet
          initialPocket={addPocket ?? undefined}
          onDismiss={() => setSheet(null)}
          onArrived={reload}
        />
      ) : null}
      {sheet === 'change' && ready ? (
        <ChangeCurrencySheet
          pockets={pockets.pockets}
          initial={opening?.sheet === 'change' ? opening : undefined}
          onDismiss={() => setSheet(null)}
          onArrived={reload}
          onAddFirst={(pocket) => {
            setAddPocket(pocket);
            setSheet('add');
          }}
        />
      ) : null}
    </section>
  );
}

function PocketRow({ pocket }: { pocket: PocketView }) {
  const store = useStore();
  const inNaira =
    pocket.usdCents !== null && store.status === 'ready' ? formatNaira(toNaira(cents(pocket.usdCents), store.rate)) : null;
  return (
    <li className="flex items-center justify-between gap-4 border-b border-hairline py-3.5">
      <span className="font-strong text-ui text-ink">{pocket.words}</span>
      <span className="text-right">
        <span className="tabular block font-display text-prose text-ink">{formatPocketAmount(pocket.cents, pocket.currency)}</span>
        {inNaira ? <span className="tabular block font-body text-note text-slate">≈ {inNaira}</span> : null}
      </span>
    </li>
  );
}

/** An amount being typed, in its currency: tabular and one size, so nothing moves. */
function EntryFigure({ sign, entry }: { sign: string; entry: AmountEntry }) {
  return (
    <p className="tabular text-center font-display text-figure-md text-ink" aria-live="polite">
      {sign}
      {entryDisplay(entry)}
    </p>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-3 text-pretty text-center font-body text-note text-halt">
      {children}
    </p>
  );
}

/** One line for where money on the move has got to. Done only when it is. */
function MovementLine({ state }: { state: MovementState }) {
  const final = FINAL_STATES.includes(state);
  const good = state === 'done';
  return (
    <p role="status" className="mt-5 flex items-center justify-center gap-2 font-strong text-ui text-ink">
      {good ? (
        <Check size={18} strokeWidth={2} aria-hidden className="text-settled" />
      ) : final ? (
        <span aria-hidden className="h-2.5 w-2.5 rounded-[2px] bg-halt" />
      ) : (
        <span aria-hidden className="h-2.5 w-2.5 animate-pulse rounded-pill bg-caution" />
      )}
      {MOVEMENT_WORDS[state]}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Add to a pocket
// ---------------------------------------------------------------------------

type Deposit = { qrPayload: string; receivesCents: number; deadline: string | null; sendCents: number };

function AddToPocketSheet({
  initialPocket,
  onDismiss,
  onArrived,
}: {
  initialPocket?: PocketId | undefined;
  onDismiss: () => void;
  onArrived: () => void;
}) {
  const { near } = useBackend();
  const [pocket, setPocket] = useState<PocketId | null>(initialPocket ?? null);
  const [source, setSource] = useState<PayInSource | null>(null);
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [deposit, setDeposit] = useState<Deposit | null>(null);
  const amountCents = Number(entryToMinor(entry));
  const state = useMovementState(near.pocketDepositState, deposit?.qrPayload ?? null, {
    onFinal: (final) => final === 'done' && onArrived(),
  });

  async function getCode() {
    if (!pocket || !source || amountCents < 100 || asking) return;
    setAsking(true);
    setProblem(null);
    try {
      const answer = await near.startPocketDeposit(pocket, source.id, amountCents);
      setDeposit({ ...answer, sendCents: amountCents });
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setAsking(false);
    }
  }

  const target = pocket ? POCKETS.find((each) => each.id === pocket)! : null;
  // What they hold in the pocket's own currency first: no exchange on the way in.
  const sources = target
    ? [...PAY_IN_SOURCES].sort((a, b) => Number(b.currency === target.currency) - Number(a.currency === target.currency))
    : [];

  return (
    <GlassSheet label="Add to a pocket" onDismiss={onDismiss}>
      <h2 className="pt-5 font-display text-subhead text-ink">Add to a pocket</h2>

      {!pocket ? (
        <>
          <p className="mt-1 pb-3 font-body text-note text-slate">Which pocket is it for?</p>
          <ul className="border-t border-hairline">
            {POCKETS.map((each) => (
              <li key={each.id}>
                <button type="button" onClick={() => setPocket(each.id)} className={ROW}>
                  <span className="flex-1 font-strong text-ui text-ink">{each.words}</span>
                  <ChevronRight size={18} strokeWidth={1.5} aria-hidden className="text-mist" />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : !source ? (
        <>
          <p className="mt-1 pb-3 text-pretty font-body text-note text-slate">
            What are you sending from? Pick it the way your other app names it. It arrives in {words(pocket)}.
          </p>
          <ul className="border-t border-hairline">
            {sources.map((each) => (
              <li key={each.id}>
                <button type="button" onClick={() => setSource(each)} className={ROW}>
                  <span className="flex-1 font-strong text-ui text-ink">{payInSourceLabel(each)}</span>
                  <ChevronRight size={18} strokeWidth={1.5} aria-hidden className="text-mist" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setPocket(null)}
            className="mt-3 min-h-11 font-strong text-ui text-ink underline decoration-mist underline-offset-4 hover:decoration-ink"
          >
            Choose another pocket
          </button>
        </>
      ) : !deposit ? (
        <div className="flex flex-col items-center pt-4">
          <p className="font-strong text-note text-slate">How much {payInSourceLabel(source)} are you sending?</p>
          <div className="mt-3">
            <EntryFigure sign={signOf(source.currency)} entry={entry} />
          </div>
          <p className="mt-1.5 font-body text-ui text-slate">
            {amountCents > 0 && amountCents < 100 ? `The least is ${formatPocketAmount(100, source.currency)}` : `Into ${words(pocket)}`}
          </p>
          {problem ? <Problem>{problem}</Problem> : null}
          <div className="mt-5 w-full">
            <Keypad onKey={(key) => setEntry((current) => pressKey(current, key))} />
          </div>
          <p className="mt-4 w-full text-pretty border-t border-hairline pt-3 text-center font-body text-note text-slate">
            This is real money. It arrives in your {words(pocket)} pocket in about a minute; nothing is sent until you
            send it from your other app.
          </p>
          <button type="button" onClick={() => void getCode()} disabled={amountCents < 100 || asking} className={`mt-4 ${PRIMARY}`}>
            {asking ? <LogoLoader size={20} label="Getting the code" mono /> : null}
            {asking ? 'Getting the code' : 'Get the code'}
          </button>
          <button
            type="button"
            onClick={() => setSource(null)}
            className="mt-2 min-h-11 font-strong text-ui text-slate underline decoration-mist underline-offset-4 hover:text-ink"
          >
            Send from something else
          </button>
        </div>
      ) : (
        <div className="pt-3">
          <p className="font-strong text-prose text-ink">
            Send {formatPocketAmount(deposit.sendCents, source.currency)} of {payInSourceLabel(source)} to this code
          </p>
          <p className="mt-1 text-pretty font-body text-note text-slate">
            Scan it from the app you are sending from, or copy it and paste it there. About{' '}
            {formatPocketAmount(deposit.receivesCents, target!.currency)} arrives in {target!.words}.
            {deposit.deadline
              ? ` The code is good until ${new Date(deposit.deadline).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
              : ''}
          </p>
          <div className="mt-5">
            <ScanCode value={deposit.qrPayload} label={`Code to send ${payInSourceLabel(source)} to`} />
          </div>
          <MovementLine state={state} />
          <p className="mt-2 text-pretty text-center font-body text-note text-slate">
            You can close this. It lands in your pocket either way, and the pocket shows it once it has.
          </p>
        </div>
      )}
    </GlassSheet>
  );
}

// ---------------------------------------------------------------------------
// Change currency
// ---------------------------------------------------------------------------

/** A dry quote for a pocket that does not hold the amount yet. Nothing can be confirmed from it. */
type SwapPreview = { receivesCents: number; receivesAtLeastCents: number; etaSeconds: number };

type SwapPhase =
  | { kind: 'enter' }
  | { kind: 'previewing' }
  | { kind: 'previewed'; preview: SwapPreview }
  | { kind: 'quoting' }
  | { kind: 'quoted'; prepared: PreparedPocketSwap }
  | { kind: 'confirming'; prepared: PreparedPocketSwap }
  | { kind: 'following'; prepared: PreparedPocketSwap; followId: string };

function PocketChoice({
  label,
  value,
  disabledId,
  onPick,
}: {
  label: string;
  value: PocketId;
  disabledId?: PocketId;
  onPick: (id: PocketId) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="font-strong text-note text-slate">{label}</legend>
      <div className="mt-2 flex gap-2">
        {POCKETS.map((pocket) => {
          const active = pocket.id === value;
          return (
            <button
              key={pocket.id}
              type="button"
              aria-pressed={active}
              disabled={pocket.id === disabledId}
              onClick={() => onPick(pocket.id)}
              className={`min-h-11 flex-1 rounded-pill border px-3 font-strong text-ui transition-colors disabled:cursor-not-allowed disabled:text-mist ${
                active ? 'border-ink bg-ink text-paper' : 'border-line bg-card text-ink hover:border-mist'
              }`}
            >
              {pocket.words}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function ChangeCurrencySheet({
  pockets,
  initial,
  onDismiss,
  onArrived,
  onAddFirst,
}: {
  pockets: PocketView[];
  /** Filled in from a link: which pockets, and how much. Never a quote, never a confirmation. */
  initial?: { from?: PocketId | undefined; to?: PocketId | undefined; amountCents?: number | undefined } | undefined;
  onDismiss: () => void;
  onArrived: () => void;
  /** The pocket is short: open Add to a pocket on it instead. */
  onAddFirst: (pocket: PocketId) => void;
}) {
  const { near } = useBackend();
  const fullest = [...pockets].sort((a, b) => (b.usdCents ?? 0) - (a.usdCents ?? 0))[0]?.id ?? 'usd';
  const startFrom = initial?.from ?? fullest;
  const startTo = initial?.to && initial.to !== startFrom ? initial.to : startFrom === 'usd' ? 'eur' : 'usd';
  const [from, setFrom] = useState<PocketId>(startFrom);
  const [to, setTo] = useState<PocketId>(startTo);
  // Cents and kobo are both hundredths, so the keypad's entry holds either.
  const [entry, setEntry] = useState<AmountEntry>(initial?.amountCents ? entryFromMinor(kobo(initial.amountCents)) : EMPTY_ENTRY);
  const [phase, setPhase] = useState<SwapPhase>({ kind: 'enter' });
  const [problem, setProblem] = useState<string | null>(null);

  const amountCents = Number(entryToMinor(entry));
  const fromPocket = pockets.find((pocket) => pocket.id === from);
  const fromDef = POCKETS.find((pocket) => pocket.id === from)!;
  const toDef = POCKETS.find((pocket) => pocket.id === to)!;
  const held = fromPocket?.cents ?? 0;
  const tooMuch = amountCents > held;

  const following = phase.kind === 'following' ? phase.followId : null;
  const state = useMovementState(near.swapState, following, {
    everyMs: 3000,
    onFinal: (final) => final === 'done' && onArrived(),
  });

  /** A change of amount or pockets makes any quote stale. */
  const edit = useCallback((change: () => void) => {
    change();
    setProblem(null);
    setPhase({ kind: 'enter' });
  }, []);

  function pickFrom(id: PocketId) {
    edit(() => {
      setFrom(id);
      if (id === to) setTo(POCKETS.find((pocket) => pocket.id !== id)!.id);
    });
  }

  async function quote() {
    if (amountCents < 100 || tooMuch) return;
    setProblem(null);
    setPhase({ kind: 'quoting' });
    try {
      setPhase({ kind: 'quoted', prepared: await near.prepareSwap(from, to, amountCents) });
    } catch (error) {
      setProblem(messageOf(error));
      setPhase({ kind: 'enter' });
    }
  }

  /** The rate only, for an amount the pocket does not hold yet. Nothing here can be confirmed. */
  async function preview() {
    if (amountCents < 100 || !tooMuch) return;
    setProblem(null);
    setPhase({ kind: 'previewing' });
    try {
      setPhase({ kind: 'previewed', preview: await near.previewSwap(from, to, amountCents) });
    } catch (error) {
      setProblem(messageOf(error));
      setPhase({ kind: 'enter' });
    }
  }

  async function confirm(prepared: PreparedPocketSwap) {
    setProblem(null);
    setPhase({ kind: 'confirming', prepared });
    try {
      const { followId } = await near.confirmSwap(prepared, { from: fromDef.currency, to: toDef.currency });
      setPhase({ kind: 'following', prepared, followId });
    } catch (error) {
      setProblem(messageOf(error));
      setPhase({ kind: 'quoted', prepared });
    }
  }

  const prepared = phase.kind === 'quoted' || phase.kind === 'confirming' || phase.kind === 'following' ? phase.prepared : null;
  const locked = phase.kind === 'confirming';

  return (
    <GlassSheet label="Change currency" onDismiss={onDismiss} locked={locked}>
      <h2 className="pt-5 font-display text-subhead text-ink">Change currency</h2>

      {phase.kind === 'following' && prepared ? (
        <div className="pt-4">
          <p className="tabular text-center font-display text-figure-sm text-ink">
            {formatPocketAmount(prepared.receivesCents, toDef.currency)}
          </p>
          <p className="mt-1 text-center font-body text-note text-slate">
            {formatPocketAmount(prepared.cents, fromDef.currency)} from {fromDef.words} into {toDef.words}
          </p>
          <MovementLine state={state} />
          {state === 'done' ? (
            <button type="button" onClick={onDismiss} className={`mt-6 ${PRIMARY}`}>
              Done
            </button>
          ) : (
            <p className="mt-2 text-pretty text-center font-body text-note text-slate">
              This usually takes about {Math.max(1, Math.round(prepared.etaSeconds))} seconds. You can close this; it carries on.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-4">
            <PocketChoice label="From" value={from} onPick={pickFrom} />
            <PocketChoice label="To" value={to} disabledId={from} onPick={(id) => edit(() => setTo(id))} />
          </div>

          <div className="mt-6 flex flex-col items-center">
            <EntryFigure sign={fromDef.sign} entry={entry} />
            <p className="tabular mt-1.5 font-body text-ui text-slate">
              {tooMuch
                ? `More than the ${formatPocketAmount(held, fromDef.currency)} in ${fromDef.words}`
                : `${formatPocketAmount(held, fromDef.currency)} in ${fromDef.words}`}
            </p>
          </div>

          {phase.kind === 'previewed' ? (
            <div role="status" className="mt-5 border-y border-hairline py-3.5 text-center">
              <p className="tabular text-pretty font-strong text-prose text-ink">
                {formatPocketAmount(amountCents, fromDef.currency)} would get about{' '}
                {formatPocketAmount(phase.preview.receivesCents, toDef.currency)} today
              </p>
              <p className="mt-1 text-pretty font-body text-note text-slate">
                Add {fromDef.words.toLowerCase()} to this pocket first. The rate is checked again when you change it.
              </p>
            </div>
          ) : null}

          {prepared ? (
            <dl className="mt-5 divide-y divide-hairline border-y border-hairline">
              <QuoteRow label="Arrives">{formatPocketAmount(prepared.receivesCents, toDef.currency)}</QuoteRow>
              <QuoteRow label="At the least">{formatPocketAmount(prepared.receivesAtLeastCents, toDef.currency)}</QuoteRow>
              <QuoteRow label="Rate">
                {formatPocketAmount(100, fromDef.currency)} to{' '}
                {formatPocketAmount(Math.floor((prepared.receivesCents * 100) / Math.max(1, prepared.cents)), toDef.currency)}
              </QuoteRow>
              <QuoteRow label="Fee">Taken off what arrives</QuoteRow>
            </dl>
          ) : null}

          {problem ? <Problem>{problem}</Problem> : null}

          {prepared ? null : (
            <div className="mt-5">
              <Keypad onKey={(key) => edit(() => setEntry((current) => pressKey(current, key)))} />
            </div>
          )}

          {prepared ? (
            <>
              <button type="button" onClick={() => void confirm(prepared)} disabled={locked} className={`mt-5 ${PRIMARY}`}>
                {locked ? <LogoLoader size={20} label="Waiting for you to confirm" mono /> : null}
                {locked ? 'Confirm with your passkey' : `Change ${formatPocketAmount(prepared.cents, fromDef.currency)}`}
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={() => edit(() => undefined)}
                className="mt-2 min-h-11 w-full font-strong text-ui text-slate hover:text-ink disabled:opacity-60"
              >
                Change the amount
              </button>
            </>
          ) : phase.kind === 'previewed' ? (
            <button type="button" onClick={() => onAddFirst(from)} className={`mt-5 ${PRIMARY}`}>
              <Plus size={20} strokeWidth={1.75} aria-hidden />
              Add to {fromDef.words}
            </button>
          ) : tooMuch && amountCents >= 100 ? (
            // More than the pocket holds: the rate can still be seen, but there is nothing to confirm.
            <button
              type="button"
              onClick={() => void preview()}
              disabled={phase.kind === 'previewing'}
              className={`mt-5 ${PRIMARY}`}
            >
              {phase.kind === 'previewing' ? <LogoLoader size={20} label="Asking for a rate" mono /> : null}
              {phase.kind === 'previewing' ? 'Asking for a rate' : 'See the rate'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void quote()}
              disabled={amountCents < 100 || tooMuch || phase.kind === 'quoting'}
              className={`mt-5 ${PRIMARY}`}
            >
              {phase.kind === 'quoting' ? <LogoLoader size={20} label="Asking for a rate" mono /> : null}
              {phase.kind === 'quoting' ? 'Asking for a rate' : 'See what arrives'}
            </button>
          )}
          {phase.kind === 'previewed' ? null : (
            <p className="mt-3 text-pretty text-center font-body text-note text-slate">
              Nothing moves until you confirm.
            </p>
          )}
        </>
      )}
    </GlassSheet>
  );
}

function QuoteRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-2.5">
      <dt className="font-body text-ui text-slate">{label}</dt>
      <dd className="tabular text-right font-strong text-ui text-ink">{children}</dd>
    </div>
  );
}
