'use client';

import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

import { EMPTY_ENTRY, entryDisplay, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import { useBackend } from '@entole/core/backend';
import { toNaira } from '@entole/core/fx';
import { cents, formatDollars, formatNaira } from '@entole/core/money';
import { RelayError, type CrossChainDeposit, type CrossChainState } from '@entole/core/relay-client';
import { useStore } from '@entole/core/store';

import { Keypad } from './Keypad';
import { LogoLoader } from './LogoLoader';
import { QrCode } from './QrCode';

/**
 * Money in from Tron or Solana, where most people here keep their dollars.
 * The person says how much they are sending, gets a scan code good for that
 * one deposit, and sees it arrive. If it cannot be completed it is not lost
 * and nobody is asked for an account over there: it is held for them under
 * their own Entole account, and one tap brings it in.
 */

type Source = { id: 'tron-usdt' | 'solana-usdc'; asset: string; place: string };

const SOURCES: Source[] = [
  { id: 'tron-usdt', asset: 'USDT', place: 'Tron' },
  { id: 'solana-usdc', asset: 'USDC', place: 'Solana' },
];

const label = (source: Source) => `${source.asset} on ${source.place}`;

/** Six decimals, as both of these are: units from cents. */
const unitsFromCents = (amountCents: number) => BigInt(amountCents) * 10_000n;
const centsFromUnits = (units: string) => Number(BigInt(units) / 10_000n);

const STATE_WORDS: Record<CrossChainState, string> = {
  waiting: 'Waiting for it to be sent.',
  on_its_way: 'On its way. This takes a minute or two.',
  arrived: 'It arrived. It is in your balance.',
  too_little: 'Less arrived than the code was for. It is held for you, and can be brought in.',
  returned: 'It could not be completed. It is held for you, and can be brought in.',
  failed: 'It could not be completed. Nothing was taken from your balance.',
};

const DONE: CrossChainState[] = ['arrived', 'too_little', 'returned', 'failed'];

function messageFor(error: unknown): string {
  if (error instanceof RelayError && error.code === 'amount_too_small') {
    return 'That is under the least this can take right now. Try a larger amount.';
  }
  return error instanceof RelayError || error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

export function FromElsewhere({ owner, onArrived }: { owner: `0x${string}`; onArrived: () => void }) {
  const store = useStore();
  const { relay } = useBackend();
  const [source, setSource] = useState<Source | null>(null);
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [deposit, setDeposit] = useState<CrossChainDeposit | null>(null);
  const [state, setState] = useState<CrossChainState>('waiting');
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const amountCents = entryToMinor(entry);

  // How far it has got, asked every few seconds until it is done or the code runs out.
  useEffect(() => {
    if (!deposit) return;
    let live = true;
    const until = deposit.deadline ? Date.parse(deposit.deadline) + 30 * 60 * 1000 : Date.now() + 90 * 60 * 1000;
    void (async () => {
      while (live && Date.now() < until) {
        try {
          const next = await relay.crossChainDepositState(deposit.qrPayload);
          if (!live) return;
          setState(next);
          if (next === 'arrived') onArrived();
          if (DONE.includes(next)) return;
        } catch {
          // A check that fails says nothing new; the next one may work.
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    })();
    return () => {
      live = false;
    };
  }, [deposit, relay, onArrived]);

  async function getCode() {
    if (!source || amountCents <= 0 || asking) return;
    setAsking(true);
    setProblem(null);
    try {
      setDeposit(await relay.startCrossChainDeposit(owner, source.id, unitsFromCents(amountCents)));
      setState('waiting');
    } catch (error) {
      setProblem(messageFor(error));
    } finally {
      setAsking(false);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  if (!source) {
    return (
      <section className="pt-7">
        <p className="font-strong text-prose text-ink">From Tron or Solana</p>
        <p className="mt-1 pb-3 text-pretty font-body text-note text-slate">
          Pick what you hold. It arrives here as dollars in your balance.
        </p>
        <ul>
          {SOURCES.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => setSource(option)}
                className="flex w-full items-center justify-between border-b border-hairline py-3.5 text-left transition-colors hover:bg-press active:translate-y-px"
              >
                <span className="font-strong text-ui text-ink">{label(option)}</span>
                <ChevronRight size={18} strokeWidth={1.5} className="text-mist" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (!deposit) {
    return (
      <section className="flex flex-col items-center pt-7">
        <p className="font-strong text-note text-slate">How much {label(source)} are you sending?</p>
        <p className="tabular mt-3 font-display text-figure text-ink">${entryDisplay(entry)}</p>
        <p className="mt-2 font-body text-ui text-slate">
          {amountCents > 0
            ? `About ${formatNaira(toNaira(cents(amountCents), store.rate))} at today's rate`
            : 'In dollars, as it shows where you hold it'}
        </p>
        {problem ? (
          <p role="alert" className="mt-3 text-center font-body text-note text-halt">
            {problem}
          </p>
        ) : null}
        <div className="mt-5 w-full">
          <Keypad onKey={(key) => setEntry((current) => pressKey(current, key))} />
        </div>
        <button
          type="button"
          onClick={() => void getCode()}
          disabled={amountCents <= 0 || asking}
          className="mt-5 flex h-14 w-full items-center justify-center gap-2.5 rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:opacity-60"
        >
          {asking ? <LogoLoader size={20} label="Getting the code" mono /> : null}
          {asking ? 'Getting the code' : 'Get the code'}
        </button>
      </section>
    );
  }

  const send = formatDollars(cents(centsFromUnits(deposit.sendUnits)));
  const least = formatDollars(cents(centsFromUnits(deposit.minimumUnits)));
  const arrives = formatNaira(toNaira(cents(centsFromUnits(deposit.arrivesAboutUnits)), store.rate));
  const until = deposit.deadline
    ? new Date(deposit.deadline).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;
  const held = state === 'returned' || state === 'too_little';

  return (
    <section className="pt-7">
      <p className="font-strong text-prose text-ink">
        Send {send} of {label(source)} to this code
      </p>
      <p className="mt-1 text-pretty font-body text-note text-slate">
        Scan it from the app you are sending from, or copy it and paste it there. {least} or more counts. About{' '}
        {arrives} arrives.{until ? ` The code is good until ${until}.` : ''}
      </p>

      <div className="mx-auto mt-5 w-full max-w-[240px]">
        <QrCode value={deposit.qrPayload} label={`Code to send ${label(source)} to`} />
      </div>
      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={() => void copy(deposit.qrPayload)}
          className="rounded-pill border border-line bg-card px-5 py-2.5 font-strong text-ui text-ink transition-colors hover:border-mist active:translate-y-px"
        >
          {copied ? 'Copied' : 'Copy code'}
        </button>
      </div>

      <p role="status" className="mt-5 border-t border-hairline pt-4 font-strong text-ui text-ink">
        {STATE_WORDS[state]}
      </p>
      {held ? <BringItIn source={source} /> : null}
      <p className="mt-4 text-pretty font-body text-note text-slate">
        Send only {label(source)}, once, for this amount. Something else sent here may not arrive.
      </p>
    </section>
  );
}

/** Brings what is held for the person home, with their own confirmation. */
function BringItIn({ source, units }: { source: Source; units?: string }) {
  const store = useStore();
  const [state, setState] = useState<'idle' | 'working' | 'sent' | 'failed'>('idle');
  const [problem, setProblem] = useState<string | null>(null);

  async function bring() {
    setState('working');
    setProblem(null);
    try {
      await store.bringBackHeld(source.id);
      setState('sent');
    } catch (error) {
      setState('failed');
      setProblem(messageFor(error));
    }
  }

  if (state === 'sent') {
    return (
      <p role="status" className="mt-3 font-body text-note text-slate">
        On its way into your balance. It takes a few minutes.
      </p>
    );
  }
  return (
    <div className="mt-3">
      {problem ? <p className="mb-2 font-body text-note text-halt">{problem}</p> : null}
      <button
        type="button"
        onClick={() => void bring()}
        disabled={state === 'working'}
        className="flex h-11 items-center gap-2.5 rounded-control bg-ink px-5 font-strong text-ui text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:opacity-60"
      >
        {state === 'working' ? <LogoLoader size={18} label="Bringing it in" mono /> : null}
        {state === 'working'
          ? 'Bringing it in'
          : units
            ? `Bring ${formatDollars(cents(centsFromUnits(units)))} in`
            : 'Bring it in'}
      </button>
    </div>
  );
}

/**
 * Said at the top of Add money when something sent from Tron or Solana came
 * back and is held for the person. Nothing is said when nothing is held.
 */
export function HeldElsewhereNotice({ owner }: { owner: `0x${string}` }) {
  const { relay } = useBackend();
  const [held, setHeld] = useState<{ source: Source; units: string }[]>([]);
  const [canBring, setCanBring] = useState(false);

  useEffect(() => {
    let live = true;
    relay
      .heldElsewhere(owner)
      .then((answer) => {
        if (!live) return;
        setCanBring(answer.canBringBack);
        setHeld(
          answer.held.flatMap((entry) => {
            const source = SOURCES.find((option) => option.id === entry.source);
            return source ? [{ source, units: entry.units }] : [];
          }),
        );
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [relay, owner]);

  if (held.length === 0) return null;
  return (
    <section role="status" className="border-b border-hairline py-4">
      {held.map(({ source, units }) => (
        <div key={source.id} className="py-1">
          <p className="font-strong text-ui text-ink">
            {formatDollars(cents(centsFromUnits(units)))} of {label(source)} is held for you
          </p>
          <p className="mt-0.5 font-body text-note text-slate">
            {canBring ? 'It came back from a deposit that could not be completed.' : 'It came back from a deposit that could not be completed. Bringing it in opens soon.'}
          </p>
          {canBring ? <BringItIn source={source} units={units} /> : null}
        </div>
      ))}
    </section>
  );
}
