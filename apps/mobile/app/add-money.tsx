import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, View } from 'react-native';

import { Amount } from '@/components/ui/Amount';
import { BankTransferSheet } from '@/components/ui/BankTransferSheet';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { Keypad } from '@/components/ui/Keypad';
import { CardStep, FromAnotherApp, WaysToAdd, type Loaded } from '@/components/ui/MoneyInWays';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { UnavailableNote } from '@/components/ui/UnavailableNote';
import { useAccount } from '@/lib/account';
import { BANK_TRANSFER, REAL_MONEY } from '@/lib/onchain';
import { EMPTY_ENTRY, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import type { DepositSource } from '@entole/core/deposit-sources';
import { useBackend } from '@entole/core/backend';
import { toDollars } from '@entole/core/fx';
import { formatDollars, formatNaira, kobo, subtractMinor } from '@entole/core/money';
import { RelayError } from '@entole/core/relay-client';
import { useStore } from '@entole/core/store';

/** How often the balance is re-read while waiting, and for how long. */
const POLL_EVERY_MS = 1500;
const POLL_FOR_MS = 20_000;
/** Real money can take minutes to be sent at all, where test money takes seconds. */
const TRANSFER_POLL_EVERY_MS = 5000;
const TRANSFER_POLL_FOR_MS = 600_000;

/** How real money comes in. Test money has no choice to make. */
type Way = 'choose' | 'another-app' | 'card' | 'bank';

type Phase =
  /** Nothing asked yet. */
  | { kind: 'idle' }
  /** The request is on its way to the server. */
  | { kind: 'requesting' }
  /** The server accepted it; the balance is being re-read until it moves. */
  | { kind: 'waiting' }
  /** The balance moved. `added` is the real difference, read from the account. */
  | { kind: 'done'; addedMinor: number }
  /** Accepted, but the balance has not moved within the window. Nothing is
   * shown as added — the person can check again. */
  | { kind: 'slow' }
  | { kind: 'failed'; code: string | null; message: string };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Adding money. Nothing here is optimistic: the balance only changes when a
 * fresh read of the account says it did, and until then the screen says it is
 * waiting.
 *
 * On the main network the money is real. It comes from an app the person
 * already holds dollars in, by card, or (once our partner id exists) by bank
 * transfer in naira. Anywhere else it is test money.
 */
export default function AddMoney() {
  const router = useRouter();
  const store = useStore();
  const { relay } = useBackend();
  const { account } = useAccount();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [way, setWay] = useState<Way>('choose');
  const [source, setSource] = useState<DepositSource | null>(null);
  const [code, setCode] = useState<Loaded<string> | null>(null);
  const [card, setCard] = useState<Loaded<string> | null>(null);
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [reviewing, setReviewing] = useState(false);
  const address = account?.owner.viemAccount.address;
  const amount = entryToMinor(entry);
  const startBalance = useRef<number>(store.balance);
  const mounted = useRef(true);
  const { refresh } = store;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const waiting = phase.kind === 'waiting';

  // Re-read the account until the balance goes up, or the window closes.
  useEffect(() => {
    if (!waiting) return;
    let live = true;
    const deadline = Date.now() + (REAL_MONEY ? TRANSFER_POLL_FOR_MS : POLL_FOR_MS);
    void (async () => {
      while (live && Date.now() < deadline) {
        try {
          await refresh();
        } catch {
          // A read that fails is just a read that shows nothing new; the next one may work.
        }
        if (!live) return;
        await sleep(REAL_MONEY ? TRANSFER_POLL_EVERY_MS : POLL_EVERY_MS);
      }
      if (live) setPhase((current) => (current.kind === 'waiting' ? { kind: 'slow' } : current));
    })();
    return () => {
      live = false;
    };
  }, [waiting, refresh]);

  // The balance moving is the only thing that completes this.
  useEffect(() => {
    if (!waiting || store.balance <= startBalance.current) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPhase({
      kind: 'done',
      addedMinor: subtractMinor(store.balance, kobo(startBalance.current)),
    });
  }, [waiting, store.balance]);

  // Coming back from the partner's page is the moment to look again.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      setPhase((current) => (current.kind === 'slow' ? { kind: 'waiting' } : current));
    });
    return () => subscription.remove();
  }, []);

  const startTransfer = useCallback(
    () => (address ? relay.startBankTransfer(address, amount) : Promise.reject(new RelayError('unreachable'))),
    [relay, address, amount],
  );

  function plain(error: unknown): string {
    return error instanceof RelayError ? error.message : 'Something went wrong. Try again.';
  }

  async function pickSource(next: DepositSource) {
    if (!address) return;
    setSource(next);
    setCode({ state: 'loading' });
    try {
      const { qrPayload } = await relay.startDeposit(address, next.id);
      if (!mounted.current) return;
      setCode({ state: 'ready', value: qrPayload });
      // From here the balance is all that counts.
      startBalance.current = store.balance;
      setPhase({ kind: 'waiting' });
    } catch (error) {
      if (mounted.current) setCode({ state: 'failed', message: plain(error) });
    }
  }

  async function openCard() {
    if (!address) return;
    setWay('card');
    setCard({ state: 'loading' });
    try {
      const { url } = await relay.startCardPayment(address);
      if (mounted.current) setCard({ state: 'ready', value: url });
    } catch (error) {
      if (mounted.current) setCard({ state: 'failed', message: plain(error) });
    }
  }

  function backToWays() {
    setWay('choose');
    setSource(null);
    setCode(null);
    setCard(null);
    setEntry(EMPTY_ENTRY);
    setPhase({ kind: 'idle' });
  }

  /** Leaves for the partner's page. From here the balance is all that counts. */
  function continueToPartner(url: string) {
    startBalance.current = store.balance;
    setReviewing(false);
    setEntry(EMPTY_ENTRY);
    setPhase({ kind: 'waiting' });
    void Linking.openURL(url).catch(() => {
      if (mounted.current) setPhase({ kind: 'failed', code: null, message: "We couldn't open the payment page. Try again." });
    });
  }

  async function addMoney() {
    if (!address) return;
    startBalance.current = store.balance;
    setPhase({ kind: 'requesting' });
    try {
      await relay.requestFunds(address);
      if (mounted.current) setPhase({ kind: 'waiting' });
    } catch (error) {
      if (!mounted.current) return;
      setPhase(
        error instanceof RelayError
          ? { kind: 'failed', code: error.code, message: error.message }
          : { kind: 'failed', code: null, message: 'Something went wrong. Try again.' },
      );
    }
  }

  const ready = store.status === 'ready';

  function primary() {
    switch (phase.kind) {
      case 'done':
        return <Button label="Done" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />;
      case 'slow':
        return <Button label="Check again" onPress={() => setPhase({ kind: 'waiting' })} />;
      case 'requesting':
        return <Button label="Adding money…" disabled />;
      case 'waiting':
        // Real money is waited on with the way back still open; test money is not.
        return REAL_MONEY ? (
          <Button label="Add another way" variant="secondary" onPress={backToWays} />
        ) : (
          <Button label="Adding money…" disabled />
        );
      default:
        if (!REAL_MONEY) {
          return (
            <Button
              label="Add test money"
              disabled={!ready || !account}
              onPress={() => void addMoney()}
            />
          );
        }
        if (way === 'choose') return null;
        if (way === 'card' && card?.state === 'ready') {
          return (
            <>
              <Button label="Back" variant="secondary" width="hug" onPress={backToWays} />
              <Button label="Continue" onPress={() => continueToPartner(card.value)} />
            </>
          );
        }
        if (way === 'bank') {
          return (
            <>
              <Button label="Back" variant="secondary" width="hug" onPress={backToWays} />
              <Button label="Review" disabled={!ready || !account || amount <= 0} onPress={() => setReviewing(true)} />
            </>
          );
        }
        return <Button label="Back" variant="secondary" onPress={backToWays} />;
    }
  }

  const idle = phase.kind === 'idle' || phase.kind === 'failed';
  const choosing = REAL_MONEY && way === 'choose' && idle;
  const entering = REAL_MONEY && way === 'bank' && idle;
  const settled = phase.kind === 'done' || phase.kind === 'slow';
  const showingCode = way === 'another-app' && code?.state === 'ready';

  return (
    <View className="flex-1">
      <Screen>
        <Header title="Add money" />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 20 }}
        >
          <View className="rounded-panel bg-card p-6 shadow-raised">
            <Text className="font-strong text-label-sm text-mist">Your balance</Text>
            {ready ? (
              <>
                <View className="mt-2.5">
                  <Amount value={store.balance} size="large" />
                </View>
                <Text tabular className="mt-3 font-body text-body-sm text-slate">
                  ≈ {formatDollars(toDollars(store.balance, store.rate))}
                </Text>
              </>
            ) : (
              <>
                <Skeleton className="mt-3 h-[48px] w-56 rounded-chip" />
                <Skeleton className="mt-3.5 h-4 w-24 rounded-md" />
              </>
            )}
          </View>

          {choosing ? (
            <WaysToAdd
              disabled={!ready || !account}
              bankOpen={BANK_TRANSFER}
              onAnotherApp={() => setWay('another-app')}
              onCard={() => void openCard()}
              onBank={() => setWay('bank')}
            />
          ) : null}

          {REAL_MONEY && way === 'another-app' && !settled ? (
            <FromAnotherApp source={source} code={code} onPick={(next) => void pickSource(next)} />
          ) : null}

          {REAL_MONEY && way === 'card' && idle ? <CardStep card={card} /> : null}

          {entering ? (
            <View className="mt-7 items-center">
              <Text className="font-strong text-label-sm text-slate">How much are you adding?</Text>
              <View className="mt-3">
                <Amount value={kobo(amount)} size="large" />
              </View>
              <Text className="mt-2.5 font-body text-body-sm text-slate">
                {amount > 0 ? 'Paid by bank transfer' : 'Enter an amount'}
              </Text>
            </View>
          ) : null}

          {!REAL_MONEY ? (
            <Text className="mt-6 px-1 font-body text-body-sm text-slate">
              Add test money to try Entole. It’s not real money.
            </Text>
          ) : null}

          <View className="mt-5" accessibilityLiveRegion="polite">
            {phase.kind === 'requesting' || phase.kind === 'waiting' ? (
              <View className="rounded-row border border-line bg-card px-4 py-4">
                <Text className="font-strong text-body-sm text-ink">
                  {phase.kind === 'requesting'
                    ? 'Adding money'
                    : REAL_MONEY
                      ? 'Waiting for your money to arrive'
                      : 'Waiting for your balance to update'}
                </Text>
                <Text className="mt-1 font-body text-label-sm text-slate">
                  {phase.kind === 'requesting'
                    ? 'Sending your request.'
                    : showingCode
                      ? 'This screen updates by itself once you have sent it. Your balance only changes when it has arrived.'
                      : REAL_MONEY
                        ? 'It can take a few minutes. Your balance only changes once it has arrived.'
                        : 'It usually takes a few seconds. Your balance only changes once it has arrived.'}
                </Text>
                <Skeleton className="mt-3.5 h-2 w-full rounded-pill" />
              </View>
            ) : null}

            {phase.kind === 'done' ? (
              <View className="rounded-row border border-line bg-settled-wash px-4 py-4">
                <Text tabular className="font-strong text-body text-settled">
                  {formatNaira(kobo(phase.addedMinor))} added
                </Text>
                <Text className="mt-1 font-body text-label-sm text-slate">
                  It’s in your balance now.
                </Text>
              </View>
            ) : null}

            {phase.kind === 'slow' ? (
              <UnavailableNote
                title={REAL_MONEY ? 'Nothing has arrived yet' : 'Still on its way'}
                body={
                  REAL_MONEY
                    ? 'If you have sent it, it is on its way. Check again in a few minutes. If you haven’t, nothing was taken.'
                    : 'Your request went through, but the money hasn’t shown up yet. Check again in a moment.'
                }
              />
            ) : null}

            {phase.kind === 'failed' && phase.code === 'not_configured' ? (
              <UnavailableNote title="Adding money" body={phase.message} />
            ) : null}

            {phase.kind === 'failed' && phase.code !== 'not_configured' ? (
              <View accessibilityRole="alert" className="rounded-row border border-line bg-halt-wash px-4 py-4">
                <Text className="font-strong text-body-sm text-halt">{phase.message}</Text>
              </View>
            ) : null}
          </View>

          <View className="mt-8 items-start px-1">
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Rates by Exchange Rate API"
              hitSlop={10}
              onPress={() => void Linking.openURL('https://www.exchangerate-api.com')}
            >
              <Text className="font-body text-caption text-mist">Rates by Exchange Rate API</Text>
            </Pressable>
          </View>
        </ScrollView>

        {entering ? (
          <View className="px-gutter pt-2">
            <Keypad onKey={(key) => setEntry((current) => pressKey(current, key))} />
          </View>
        ) : null}
        {choosing ? null : <ActionBar divided={!entering}>{primary()}</ActionBar>}
      </Screen>

      {reviewing ? (
        <BankTransferSheet start={startTransfer} onContinue={continueToPartner} onDismiss={() => setReviewing(false)} />
      ) : null}
    </View>
  );
}
