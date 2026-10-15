import * as Clipboard from 'expo-clipboard';
import { ChevronRight } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { EMPTY_ENTRY, entryDisplay, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import { useBackend } from '@entole/core/backend';
import { toNaira } from '@entole/core/fx';
import { cents, formatDollars, formatNaira } from '@entole/core/money';
import { RelayError, type CrossChainDeposit, type CrossChainState } from '@entole/core/relay-client';
import { useStore } from '@entole/core/store';
import { token } from '@entole/tokens';

import { useThemeColors } from '@/lib/theme';

import { Button } from './Button';
import { Keypad } from './Keypad';
import { Text } from './Text';

/**
 * Money in from Tron or Solana, where most people here keep their dollars.
 * The person says how much they are sending, gets a scan code good for that
 * one deposit, and sees it arrive. If it cannot be completed it is not lost
 * and nobody is asked for an account over there: it is held for them under
 * their own Entole account, and one tap brings it in. The phone twin of
 * `apps/web/components/FromElsewhere.tsx`.
 */

type Source = { id: 'tron-usdt' | 'solana-usdc'; asset: string; place: string };

const SOURCES: Source[] = [
  { id: 'tron-usdt', asset: 'USDT', place: 'Tron' },
  { id: 'solana-usdc', asset: 'USDC', place: 'Solana' },
];

const label = (source: Source) => `${source.asset} on ${source.place}`;
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
  const colors = useThemeColors();
  const [source, setSource] = useState<Source | null>(null);
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [deposit, setDeposit] = useState<CrossChainDeposit | null>(null);
  const [state, setState] = useState<CrossChainState>('waiting');
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const amountCents = entryToMinor(entry);

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

  if (!source) {
    return (
      <View className="pt-7">
        <Text className="font-strong text-prose text-ink">From Tron or Solana</Text>
        <Text className="mt-1 pb-3 font-body text-note text-slate">
          Pick what you hold. It arrives here as dollars in your balance.
        </Text>
        {SOURCES.map((option) => (
          <Pressable
            key={option.id}
            accessibilityRole="button"
            onPress={() => setSource(option)}
            className="flex-row items-center justify-between border-b border-hairline py-3.5 active:bg-press"
          >
            <Text className="font-strong text-ui text-ink">{label(option)}</Text>
            <ChevronRight size={18} strokeWidth={1.5} color={colors.mist} />
          </Pressable>
        ))}
      </View>
    );
  }

  if (!deposit) {
    return (
      <View className="items-center pt-7">
        <Text className="font-strong text-note text-slate">How much {label(source)} are you sending?</Text>
        <Text tabular className="mt-3 font-display text-figure text-ink">
          ${entryDisplay(entry)}
        </Text>
        <Text className="mt-2 font-body text-ui text-slate">
          {amountCents > 0
            ? `About ${formatNaira(toNaira(cents(amountCents), store.rate))} at today's rate`
            : 'In dollars, as it shows where you hold it'}
        </Text>
        {problem ? (
          <Text accessibilityRole="alert" className="mt-3 text-center font-body text-note text-halt">
            {problem}
          </Text>
        ) : null}
        <View className="mt-5 w-full">
          <Keypad onKey={(key) => setEntry((current) => pressKey(current, key))} />
        </View>
        <View className="mt-5 w-full flex-row">
          <Button
            label={asking ? 'Getting the code' : 'Get the code'}
            busy={asking}
            disabled={amountCents <= 0}
            onPress={() => void getCode()}
          />
        </View>
      </View>
    );
  }

  const send = formatDollars(cents(centsFromUnits(deposit.sendUnits)));
  const least = formatDollars(cents(centsFromUnits(deposit.minimumUnits)));
  const arrives = formatNaira(toNaira(cents(centsFromUnits(deposit.arrivesAboutUnits)), store.rate));
  const held = state === 'returned' || state === 'too_little';

  return (
    <View className="pt-7">
      <Text className="font-strong text-prose text-ink">
        Send {send} of {label(source)} to this code
      </Text>
      <Text className="mt-1 font-body text-note text-slate">
        Scan it from the app you are sending from, or copy it and paste it there. {least} or more counts. About{' '}
        {arrives} arrives.
      </Text>
      <View className="mt-5 items-center">
        {/* Always dark on white, in either theme: many scanners will not read a light-on-dark square. */}
        <View
          accessibilityRole="image"
          accessibilityLabel={`Code to send ${label(source)} to`}
          className="rounded-card border border-hairline bg-white p-3"
        >
          <QRCode value={deposit.qrPayload} size={208} color={token.ink} backgroundColor={token.white} />
        </View>
      </View>
      <View className="mt-4 flex-row justify-center">
        <Button
          label={copied ? 'Copied' : 'Copy code'}
          variant="secondary"
          width="hug"
          onPress={() => {
            void Clipboard.setStringAsync(deposit.qrPayload).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            });
          }}
        />
      </View>
      <Text accessibilityRole="summary" className="mt-5 border-t border-hairline pt-4 font-strong text-ui text-ink">
        {STATE_WORDS[state]}
      </Text>
      {held ? <BringItIn source={source} /> : null}
      <Text className="mt-4 font-body text-note text-slate">
        Send only {label(source)}, once, for this amount. Something else sent here may not arrive.
      </Text>
    </View>
  );
}

function BringItIn({ source, units }: { source: Source; units?: string }) {
  const store = useStore();
  const [state, setState] = useState<'idle' | 'working' | 'sent'>('idle');
  const [problem, setProblem] = useState<string | null>(null);

  async function bring() {
    setState('working');
    setProblem(null);
    try {
      await store.bringBackHeld(source.id);
      setState('sent');
    } catch (error) {
      setState('idle');
      setProblem(messageFor(error));
    }
  }

  if (state === 'sent') {
    return <Text className="mt-3 font-body text-note text-slate">On its way into your balance. It takes a few minutes.</Text>;
  }
  return (
    <View className="mt-3">
      {problem ? <Text className="mb-2 font-body text-note text-halt">{problem}</Text> : null}
      <View className="flex-row">
        <Button
          label={
            state === 'working'
              ? 'Bringing it in'
              : units
                ? `Bring ${formatDollars(cents(centsFromUnits(units)))} in`
                : 'Bring it in'
          }
          width="hug"
          busy={state === 'working'}
          onPress={() => void bring()}
        />
      </View>
    </View>
  );
}

/** Said at the top of Add money when something sent from Tron or Solana came back and is held. */
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
    <View accessibilityRole="summary" className="border-b border-hairline py-4">
      {held.map(({ source, units }) => (
        <View key={source.id} className="py-1">
          <Text className="font-strong text-ui text-ink">
            {formatDollars(cents(centsFromUnits(units)))} of {label(source)} is held for you
          </Text>
          <Text className="mt-0.5 font-body text-note text-slate">
            {canBring
              ? 'It came back from a deposit that could not be completed.'
              : 'It came back from a deposit that could not be completed. Bringing it in opens soon.'}
          </Text>
          {canBring ? <BringItIn source={source} units={units} /> : null}
        </View>
      ))}
    </View>
  );
}
