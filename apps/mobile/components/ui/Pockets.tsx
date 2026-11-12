import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { EMPTY_ENTRY, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import { useBackend } from '@entole/core/backend';
import { toNaira } from '@entole/core/fx';
import {
  formatPocketAmount,
  MOVEMENT_WORDS,
  PAY_IN_SOURCES,
  payInSourceLabel,
  POCKETS,
  type MovementState,
  type PayInSource,
  type PocketCurrency,
  type PocketDefinition,
} from '@entole/core/intents-pockets';
import { cents, formatNaira } from '@entole/core/money';
import { NearClientError, type PocketView, type PreparedPocketSwap } from '@entole/core/near-client';
import { useStore } from '@entole/core/store';
import { token } from '@entole/tokens';

import { plainMessage } from '@/lib/send';
import { useThemeColors } from '@/lib/theme';

import { Button } from './Button';
import { Keypad } from './Keypad';
import { DetailRow } from './Rows';
import { Sheet, SheetLayer } from './Sheet';
import { Skeleton } from './Skeleton';
import { Text } from './Text';

/**
 * Pockets: money held in dollars, euros and pounds beside the naira balance.
 * Each is a ruled row, its amount in its own currency and what that is in
 * naira today. Adding to one is a one-time scan code for the app the person
 * already sends from; changing one currency into another is quoted first
 * (what arrives, and the least it can be), confirmed with the person's own
 * fingerprint, and shown moving until it has arrived. Never sooner.
 */

/** The least and most a pocket movement takes, in the currency's cents. */
const LEAST_CENTS = 100;
const MOST_CENTS = 10_000_000;
const CHECK_EVERY_MS = 5000;
const FINISHED: MovementState[] = ['done', 'too_little', 'returned', 'failed'];

const CURRENCY_WORDS: Record<PocketCurrency, string> = { USD: 'dollars', EUR: 'euros', GBP: 'pounds' };

export type PocketsState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; pockets: PocketView[] };

/** Reads the pockets when the screen comes into view, and on demand after something moves. */
export function usePockets() {
  const { near } = useBackend();
  const [state, setState] = useState<PocketsState>({ status: 'loading' });

  const reload = useCallback(async () => {
    try {
      const pockets = await near.pockets();
      setState({ status: 'ready', pockets });
    } catch (error) {
      // A re-read that fails keeps the last real figures; only a first read shows the failure.
      setState((current) =>
        current.status === 'ready'
          ? current
          : {
              status: 'failed',
              message:
                error instanceof NearClientError && error.code === 'not_configured'
                  ? "Pockets aren't switched on yet."
                  : plainMessage(error, "We can't read your pockets right now."),
            },
      );
    }
  }, [near]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { state, reload };
}

/** "≈ ₦18,450" from a pocket's value in US cents, at the account's own rate. */
function nairaWorth(usdCents: number | null, rate: ReturnType<typeof useStore>['rate'], rateKnown: boolean) {
  if (usdCents === null || !rateKnown) return null;
  return `≈ ${formatNaira(toNaira(cents(usdCents), rate))}`;
}

export function PocketRowsSkeleton() {
  return (
    <View accessibilityLabel="Loading pockets" className="border-t border-hairline">
      {[0, 1, 2].map((row) => (
        <View key={row} className="flex-row items-center justify-between border-b border-hairline py-4">
          <View>
            <Skeleton className="h-4 w-20 rounded-md" />
            <Skeleton className="mt-2 h-3 w-24 rounded-md" />
          </View>
          <Skeleton className="h-5 w-24 rounded-md" />
        </View>
      ))}
    </View>
  );
}

/** The three pockets as ruled rows, and the two things that can be done with them. */
export function PocketsSection({
  state,
  onRetry,
  onAdd,
  onChange,
}: {
  state: PocketsState;
  onRetry: () => void;
  onAdd: () => void;
  onChange: () => void;
}) {
  const store = useStore();
  const rateKnown = store.status === 'ready';

  if (state.status === 'loading') return <PocketRowsSkeleton />;

  if (state.status === 'failed') {
    return (
      <View className="border-y border-hairline py-4">
        <Text className="font-strong text-ui text-ink">{state.message}</Text>
        <Text className="mt-1 font-body text-note text-slate">Nothing has changed in them.</Text>
        <View className="mt-3 flex-row">
          <Button label="Try again" variant="secondary" width="hug" onPress={onRetry} />
        </View>
      </View>
    );
  }

  const anything = state.pockets.some((pocket) => pocket.cents > 0);

  return (
    <View>
      <View className="border-t border-hairline">
        {POCKETS.map((definition) => {
          const pocket = state.pockets.find((entry) => entry.id === definition.id);
          const held = pocket?.cents ?? 0;
          const worth = pocket && held > 0 ? nairaWorth(pocket.usdCents, store.rate, rateKnown) : null;
          return (
            <View
              key={definition.id}
              accessible
              accessibilityLabel={`${definition.words}, ${formatPocketAmount(held, definition.currency)}`}
              className="flex-row items-center justify-between gap-4 border-b border-hairline py-4"
            >
              <View className="min-w-0 flex-1">
                <Text className="font-strong text-prose text-ink">{definition.words}</Text>
                <Text tabular className="mt-0.5 font-body text-note text-slate">
                  {held === 0 ? 'Nothing here yet' : (worth ?? 'Naira value shows when the rate is in')}
                </Text>
              </View>
              <Text tabular className="font-display text-subhead text-ink">
                {formatPocketAmount(held, definition.currency)}
              </Text>
            </View>
          );
        })}
      </View>
      {!anything ? (
        <Text className="mt-3 font-body text-note text-slate">
          Keep money in dollars, euros or pounds. Add to a pocket from an app you already use.
        </Text>
      ) : null}
      <View className="mt-4 flex-row gap-2.5">
        <Button label="Add to a pocket" variant="secondary" onPress={onAdd} />
        <Button label="Change currency" variant="secondary" disabled={!anything} onPress={onChange} />
      </View>
    </View>
  );
}

// ------------------------------------------------------------ shared parts

function ChoiceRow({ label, caption, onPress }: { label: string; caption?: string; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="min-h-[56px] flex-row items-center gap-3 border-b border-hairline py-3.5 active:bg-press"
    >
      <View className="min-w-0 flex-1">
        <Text className="font-strong text-ui text-ink">{label}</Text>
        {caption ? <Text className="mt-0.5 font-body text-note text-slate">{caption}</Text> : null}
      </View>
      <ChevronRight size={18} strokeWidth={1.5} color={colors.mist} />
    </Pressable>
  );
}

function Chip({ label, chosen, onPress, disabled }: { label: string; chosen: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: chosen, disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-[44px] justify-center rounded-pill border px-4 ${
        chosen ? 'border-ink bg-ink' : 'border-line bg-card'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <Text className={`font-strong text-note ${chosen ? 'text-paper' : 'text-ink'}`}>{label}</Text>
    </Pressable>
  );
}

/** Asks where a movement has got to every few seconds, until it is finished or the sheet closes. */
function useMovement(follow: string | null, check: (id: string) => Promise<MovementState>, onFinished: (state: MovementState) => void) {
  // Keyed by what is followed, so a new code or swap starts at waiting without resetting state in an effect.
  const [seen, setSeen] = useState<{ id: string; state: MovementState } | null>(null);
  const finished = useRef(onFinished);
  useEffect(() => {
    finished.current = onFinished;
  });

  useEffect(() => {
    if (!follow) return;
    let live = true;
    void (async () => {
      while (live) {
        try {
          const next = await check(follow);
          if (!live) return;
          setSeen({ id: follow, state: next });
          if (FINISHED.includes(next)) {
            finished.current(next);
            return;
          }
        } catch {
          // A check that fails says nothing new; the next one may work.
        }
        await new Promise((resolve) => setTimeout(resolve, CHECK_EVERY_MS));
      }
    })();
    return () => {
      live = false;
    };
  }, [follow, check]);

  return seen && seen.id === follow ? seen.state : 'waiting';
}

function amountProblem(amountCents: number, currency: PocketCurrency, most = MOST_CENTS): string | null {
  if (amountCents <= 0) return null;
  if (amountCents < LEAST_CENTS) return `The least is ${formatPocketAmount(LEAST_CENTS, currency)}.`;
  if (amountCents > most) return `That is more than ${formatPocketAmount(most, currency)}.`;
  return null;
}

function waitWords(seconds: number): string {
  if (seconds <= 90) return 'under two minutes';
  return `about ${Math.round(seconds / 60)} minutes`;
}

// ------------------------------------------------------------ add to a pocket

type AddStep =
  | { kind: 'pocket' }
  | { kind: 'source'; pocket: PocketDefinition }
  | { kind: 'amount'; pocket: PocketDefinition; source: PayInSource }
  | {
      kind: 'code';
      pocket: PocketDefinition;
      source: PayInSource;
      sendCents: number;
      deposit: { qrPayload: string; receivesCents: number; etaSeconds: number };
    };

/**
 * Adding to a pocket from another app: which pocket, what they hold there,
 * how much, then a one-time scan code with a copy button. The code is never
 * spelled out. What it says under it is where the money has got to.
 */
export function AddToPocketSheet({ onDismiss, onArrived }: { onDismiss: () => void; onArrived: () => void }) {
  const { near } = useBackend();
  const [step, setStep] = useState<AddStep>({ kind: 'pocket' });
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const check = useCallback((id: string) => near.pocketDepositState(id), [near]);
  const state = useMovement(step.kind === 'code' ? step.deposit.qrPayload : null, check, (finished) => {
    if (finished === 'done') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onArrived();
    }
  });

  const amountCents = Number(entryToMinor(entry));

  async function getCode() {
    if (step.kind !== 'amount' || asking) return;
    setAsking(true);
    setProblem(null);
    try {
      const deposit = await near.startPocketDeposit(step.pocket.id, step.source.id, amountCents);
      setStep({ kind: 'code', pocket: step.pocket, source: step.source, sendCents: amountCents, deposit });
    } catch (error) {
      setProblem(plainMessage(error, "We couldn't make a code just now. Try again."));
    } finally {
      setAsking(false);
    }
  }

  return (
    <SheetLayer>
      <Sheet onDismiss={onDismiss} handleOnly>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {step.kind === 'pocket' ? (
            <View>
              <Text accessibilityRole="header" className="font-display text-subhead text-ink">
                Add to a pocket
              </Text>
              <Text className="mt-1 pb-3 font-body text-ui text-slate">Which pocket should it go into?</Text>
              {POCKETS.map((pocket) => (
                <ChoiceRow
                  key={pocket.id}
                  label={pocket.words}
                  caption={`Kept in ${CURRENCY_WORDS[pocket.currency]}`}
                  onPress={() => setStep({ kind: 'source', pocket })}
                />
              ))}
            </View>
          ) : step.kind === 'source' ? (
            <View>
              <Text accessibilityRole="header" className="font-display text-subhead text-ink">
                What are you sending from?
              </Text>
              <Text className="mt-1 pb-3 font-body text-ui text-slate">
                Pick what you hold in the other app. It arrives here as {CURRENCY_WORDS[step.pocket.currency]}.
              </Text>
              {[...PAY_IN_SOURCES]
                .sort((a, b) => Number(b.currency === step.pocket.currency) - Number(a.currency === step.pocket.currency))
                .map((source) => (
                  <ChoiceRow
                    key={source.id}
                    label={payInSourceLabel(source)}
                    {...(source.currency !== step.pocket.currency
                      ? { caption: `Changed into ${CURRENCY_WORDS[step.pocket.currency]} on the way` }
                      : {})}
                    onPress={() => {
                      setEntry(EMPTY_ENTRY);
                      setProblem(null);
                      setStep({ kind: 'amount', pocket: step.pocket, source });
                    }}
                  />
                ))}
              <View className="mt-4 flex-row">
                <Button label="Back" variant="quiet" width="hug" onPress={() => setStep({ kind: 'pocket' })} />
              </View>
            </View>
          ) : step.kind === 'amount' ? (
            <View>
              <Text className="text-center font-strong text-note text-slate">
                How much {payInSourceLabel(step.source)} are you sending?
              </Text>
              <Text tabular className="mt-3 text-center font-display text-figure text-ink">
                {formatPocketAmount(amountCents, step.source.currency)}
              </Text>
              <Text accessibilityLiveRegion="polite" className="mt-2 text-center font-body text-note text-slate">
                {amountProblem(amountCents, step.source.currency) ??
                  `Into your ${step.pocket.words} pocket. The code shows what arrives.`}
              </Text>
              {problem ? (
                <Text accessibilityRole="alert" className="mt-2 text-center font-body text-note text-halt">
                  {problem}
                </Text>
              ) : null}
              <View className="mt-4">
                <Keypad onKey={(key) => setEntry((current) => pressKey(current, key))} />
              </View>
              <View className="mt-3 flex-row gap-2.5">
                <Button
                  label="Back"
                  variant="secondary"
                  onPress={() => setStep({ kind: 'source', pocket: step.pocket })}
                />
                <Button
                  label={asking ? 'Getting the code' : 'Get the code'}
                  busy={asking}
                  disabled={amountCents <= 0 || amountProblem(amountCents, step.source.currency) !== null}
                  onPress={() => void getCode()}
                />
              </View>
            </View>
          ) : (
            <View>
              <Text className="font-strong text-prose text-ink">
                Send {formatPocketAmount(step.sendCents, step.source.currency)} of {payInSourceLabel(step.source)}
              </Text>
              <Text className="mt-1 font-body text-note text-slate">
                Scan this from the app you are sending from, or copy it and paste it there. About{' '}
                {formatPocketAmount(step.deposit.receivesCents, step.pocket.currency)} arrives in your{' '}
                {step.pocket.words} pocket, usually in {waitWords(step.deposit.etaSeconds)}.
              </Text>
              <View className="mt-5 items-center">
                {/* Always dark on white, in either theme: many scanners will not read a light-on-dark square. */}
                <View
                  accessibilityRole="image"
                  accessibilityLabel={`Scan code for sending ${payInSourceLabel(step.source)}`}
                  className="rounded-card border border-hairline bg-white p-3"
                >
                  <QRCode value={step.deposit.qrPayload} size={196} color={token.ink} backgroundColor={token.white} />
                </View>
              </View>
              <View className="mt-4 flex-row justify-center">
                <Button
                  label={copied ? 'Copied' : 'Copy code'}
                  variant="secondary"
                  width="hug"
                  onPress={() => {
                    void Clipboard.setStringAsync(step.deposit.qrPayload).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2500);
                    });
                  }}
                />
              </View>
              <View
                accessibilityRole="summary"
                accessibilityLiveRegion="polite"
                className="mt-5 flex-row items-center gap-2.5 border-t border-hairline pt-4"
              >
                <View
                  className={`h-2.5 w-2.5 rounded-pill ${
                    state === 'done' ? 'bg-settled' : state === 'failed' || state === 'returned' ? 'bg-halt' : 'bg-caution'
                  }`}
                />
                <Text className="flex-1 font-strong text-ui text-ink">{MOVEMENT_WORDS[state]}</Text>
              </View>
              {state === 'too_little' || state === 'returned' || state === 'failed' ? (
                <Text className="mt-1 font-body text-note text-slate">
                  Nothing is lost: anything that could not be completed is held for you under your account.
                </Text>
              ) : null}
              <Text className="mt-4 font-body text-note text-slate">
                Send only {payInSourceLabel(step.source)}, once, for this amount. Something else sent here may not
                arrive.
              </Text>
              <View className="mt-5 flex-row">
                <Button label={state === 'done' ? 'Done' : 'Close'} variant={state === 'done' ? 'primary' : 'secondary'} onPress={onDismiss} />
              </View>
              {state !== 'done' && !FINISHED.includes(state) ? (
                <Text className="mt-2 text-center font-body text-note text-slate">
                  Closing this does not stop it. Your pocket updates when it arrives.
                </Text>
              ) : null}
            </View>
          )}
        </ScrollView>
      </Sheet>
    </SheetLayer>
  );
}

// ------------------------------------------------------------ change currency

type ChangeStep =
  | { kind: 'amount' }
  | { kind: 'quote'; prepared: PreparedPocketSwap }
  | { kind: 'moving'; prepared: PreparedPocketSwap; followId: string };

/**
 * One pocket into another. The quote comes first and says what arrives and
 * the least it can be; nothing moves until the person confirms, and then the
 * sheet says where it has got to, not where it is expected to be.
 */
export function ChangeCurrencySheet({
  pockets,
  onDismiss,
  onFinished,
}: {
  pockets: PocketView[];
  onDismiss: () => void;
  onFinished: () => void;
}) {
  const { near } = useBackend();
  const funded = POCKETS.filter((pocket) => (pockets.find((entry) => entry.id === pocket.id)?.cents ?? 0) > 0);
  const [from, setFrom] = useState<PocketDefinition>(funded[0] ?? POCKETS[0]!);
  const [to, setTo] = useState<PocketDefinition>(POCKETS.find((pocket) => pocket.id !== (funded[0] ?? POCKETS[0]!).id)!);
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [step, setStep] = useState<ChangeStep>({ kind: 'amount' });
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const held = pockets.find((pocket) => pocket.id === from.id)?.cents ?? 0;
  const amountCents = Number(entryToMinor(entry));
  const tooMuch = amountCents > held;
  const rangeProblem = amountProblem(amountCents, from.currency);

  const check = useCallback((id: string) => near.swapState(id), [near]);
  const state = useMovement(step.kind === 'moving' ? step.followId : null, check, (finished) => {
    if (finished === 'done') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onFinished();
  });

  function pickFrom(pocket: PocketDefinition) {
    setFrom(pocket);
    if (to.id === pocket.id) setTo(POCKETS.find((other) => other.id !== pocket.id)!);
    setProblem(null);
  }

  async function quote() {
    if (working) return;
    setWorking(true);
    setProblem(null);
    try {
      setStep({ kind: 'quote', prepared: await near.prepareSwap(from.id, to.id, amountCents) });
    } catch (error) {
      setProblem(plainMessage(error, "We couldn't get a quote just now. Try again."));
    } finally {
      setWorking(false);
    }
  }

  async function confirm(prepared: PreparedPocketSwap) {
    if (working) return;
    setWorking(true);
    setProblem(null);
    try {
      const { followId } = await near.confirmSwap(prepared, { from: from.currency, to: to.currency });
      setStep({ kind: 'moving', prepared, followId });
    } catch (error) {
      setProblem(plainMessage(error, "That didn't go through. Nothing was moved."));
    } finally {
      setWorking(false);
    }
  }

  const moving = step.kind === 'moving' && !FINISHED.includes(state);

  return (
    <SheetLayer>
      <Sheet onDismiss={onDismiss} handleOnly locked={working}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {step.kind === 'amount' ? (
            <View>
              <Text accessibilityRole="header" className="font-display text-subhead text-ink">
                Change currency
              </Text>
              <Text className="mt-4 font-strong text-note text-slate">From</Text>
              <View className="mt-2 flex-row flex-wrap gap-2">
                {POCKETS.map((pocket) => (
                  <Chip
                    key={pocket.id}
                    label={pocket.words}
                    chosen={pocket.id === from.id}
                    disabled={!funded.some((option) => option.id === pocket.id)}
                    onPress={() => pickFrom(pocket)}
                  />
                ))}
              </View>
              <Text className="mt-4 font-strong text-note text-slate">Into</Text>
              <View className="mt-2 flex-row flex-wrap gap-2">
                {POCKETS.filter((pocket) => pocket.id !== from.id).map((pocket) => (
                  <Chip key={pocket.id} label={pocket.words} chosen={pocket.id === to.id} onPress={() => setTo(pocket)} />
                ))}
              </View>
              <Text tabular className="mt-5 text-center font-display text-figure text-ink">
                {formatPocketAmount(amountCents, from.currency)}
              </Text>
              <Text
                tabular
                accessibilityLiveRegion="polite"
                className={`mt-1 text-center font-body text-note ${tooMuch ? 'text-halt' : 'text-slate'}`}
              >
                {tooMuch
                  ? `That is more than the ${formatPocketAmount(held, from.currency)} in ${from.words}.`
                  : (rangeProblem ?? `You have ${formatPocketAmount(held, from.currency)} in ${from.words}.`)}
              </Text>
              {problem ? (
                <Text accessibilityRole="alert" className="mt-2 text-center font-body text-note text-halt">
                  {problem}
                </Text>
              ) : null}
              <View className="mt-3">
                <Keypad onKey={(key) => setEntry((current) => pressKey(current, key))} />
              </View>
              <View className="mt-3 flex-row">
                <Button
                  label={working ? 'Getting a quote' : 'See what arrives'}
                  busy={working}
                  disabled={amountCents <= 0 || tooMuch || rangeProblem !== null}
                  onPress={() => void quote()}
                />
              </View>
            </View>
          ) : step.kind === 'quote' ? (
            <View>
              <Text accessibilityRole="header" className="font-display text-subhead text-ink">
                Change {formatPocketAmount(step.prepared.cents, from.currency)} into {CURRENCY_WORDS[to.currency]}
              </Text>
              <View className="mt-4 border-t border-hairline">
                <DetailRow label="You change" value={formatPocketAmount(step.prepared.cents, from.currency)} />
                <DetailRow label="About this arrives" value={formatPocketAmount(step.prepared.receivesCents, to.currency)} />
                <DetailRow label="At least" value={formatPocketAmount(step.prepared.receivesAtLeastCents, to.currency)} />
                <DetailRow
                  label="Rate"
                  value={`${formatPocketAmount(100, from.currency)} ≈ ${formatPocketAmount(
                    Math.round((step.prepared.receivesCents / step.prepared.cents) * 100),
                    to.currency,
                  )}`}
                />
                <DetailRow label="Takes" value={waitWords(step.prepared.etaSeconds)} tabular={false} />
              </View>
              <Text className="mt-3 font-body text-note text-slate">
                What arrives is after every fee. Nothing else is taken. If the rate moves past the least, it does not go
                ahead and your {from.words} stay where they are.
              </Text>
              {problem ? (
                <Text accessibilityRole="alert" className="mt-3 font-body text-note text-halt">
                  {problem}
                </Text>
              ) : null}
              <View className="mt-5 flex-row gap-2.5">
                <Button label="Back" variant="secondary" disabled={working} onPress={() => setStep({ kind: 'amount' })} />
                <Button
                  label={working ? 'Confirming' : 'Change it'}
                  busy={working}
                  onPress={() => void confirm(step.prepared)}
                />
              </View>
            </View>
          ) : (
            <View>
              <Text accessibilityRole="header" className="font-display text-subhead text-ink">
                {state === 'done'
                  ? `${formatPocketAmount(step.prepared.receivesCents, to.currency)} is in ${to.words}`
                  : `Changing ${formatPocketAmount(step.prepared.cents, from.currency)} into ${CURRENCY_WORDS[to.currency]}`}
              </Text>
              <View
                accessibilityRole="summary"
                accessibilityLiveRegion="polite"
                className="mt-4 flex-row items-center gap-2.5 border-y border-hairline py-4"
              >
                <View
                  className={`h-2.5 w-2.5 rounded-pill ${
                    state === 'done' ? 'bg-settled' : state === 'failed' || state === 'returned' ? 'bg-halt' : 'bg-caution'
                  }`}
                />
                <Text className="flex-1 font-strong text-ui text-ink">{MOVEMENT_WORDS[state]}</Text>
              </View>
              <Text className="mt-3 font-body text-note text-slate">
                {state === 'done'
                  ? 'Your pockets show the new amounts.'
                  : FINISHED.includes(state)
                    ? `Your ${from.words} were not changed, or were given back.`
                    : `Usually ${waitWords(step.prepared.etaSeconds)}. Closing this does not stop it.`}
              </Text>
              <View className="mt-5 flex-row">
                <Button label={moving ? 'Close' : 'Done'} variant={moving ? 'secondary' : 'primary'} onPress={onDismiss} />
              </View>
            </View>
          )}
        </ScrollView>
      </Sheet>
    </SheetLayer>
  );
}
