import { useNavigation, useRouter } from 'expo-router';
import { Check, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, View } from 'react-native';

import { formatNaira, kobo } from '@entole/core/money';
import { oneOffId } from '@entole/core/one-off';
import { useStore } from '@entole/core/store';

import { AmountSheet } from '@/components/ui/AmountSheet';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { RowSkeleton, Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import {
  affordability,
  lineProblem,
  peopleWords,
  planTotals,
  runPayroll,
  shortByWords,
  summarise,
  unsettled,
  type PayState,
  type RunLine,
} from '@/lib/payroll-run';
import { plainMessage } from '@/lib/send';
import { useStaff } from '@/lib/staff';
import { useThemeColors } from '@/lib/theme';

type Phase = 'choose' | 'running' | 'done';

function SummaryLine({ label, children, strong = false }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <View className="flex-row items-center justify-between py-2.5">
      <Text className={`font-body text-label ${strong ? 'text-ink' : 'text-slate'}`}>{label}</Text>
      {children}
    </View>
  );
}

/**
 * Run payroll. Choose who to pay this time and what, see the real total and the
 * real fees, confirm — then each person is paid one after another, and every
 * row shows what is actually happening to it: waiting, paying, paid, or the
 * plain reason it didn't go through. A row is never shown as paid before the
 * payment has settled. If your balance runs out the run stops there, and
 * "Retry" pays exactly the people who were not paid.
 */
export default function RunPayroll() {
  const router = useRouter();
  const navigation = useNavigation();
  const colors = useThemeColors();
  const store = useStore();
  const team = useStaff();
  const { quoteSend } = store;

  const [phase, setPhase] = useState<Phase>('choose');
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set());
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [runLines, setRunLines] = useState<RunLine[]>([]);
  const [states, setStates] = useState<Record<string, PayState>>({});
  const [stoppedForBalance, setStoppedForBalance] = useState(false);

  const [fees, setFees] = useState<ReadonlyMap<number, number>>(new Map());
  const [feeProblem, setFeeProblem] = useState<string | null>(null);
  const [feeTry, setFeeTry] = useState(0);
  const feeCache = useRef(new Map<number, number>());

  const loading = store.status === 'loading' || team.status === 'loading';

  // One line per person on the roster: what they would be paid, and whether that can be paid.
  const people = useMemo(
    () =>
      team.staff.map((person) => {
        const amountMinor = amounts[person.id] ?? person.payAmountMinor ?? 0;
        const problem = lineProblem(amountMinor, store.rate);
        return { person, amountMinor, problem, chosen: problem === null && !dropped.has(person.id) };
      }),
    [team.staff, amounts, dropped, store.rate],
  );

  const lines: RunLine[] = useMemo(
    () =>
      people
        .filter((row) => row.chosen)
        .map((row) => ({ id: row.person.id, name: row.person.name, code: row.person.code, amountMinor: row.amountMinor })),
    [people],
  );

  // Asks for every distinct amount's fee at once. Only its answer sets state.
  const amountsKey = [...new Set(lines.map((line) => line.amountMinor))].sort((a, b) => a - b).join(',');
  useEffect(() => {
    if (phase !== 'choose' || !amountsKey) return;
    const missing = amountsKey
      .split(',')
      .map(Number)
      .filter((amount) => !feeCache.current.has(amount));
    if (missing.length === 0) return;

    let live = true;
    Promise.allSettled(missing.map((amount) => quoteSend(amount))).then((results) => {
      if (!live) return;
      let failure: string | null = null;
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') feeCache.current.set(missing[index]!, result.value.feeMinor);
        else failure = plainMessage(result.reason, "We couldn't work out the fees.");
      });
      setFees(new Map(feeCache.current));
      setFeeProblem(failure);
    });
    return () => {
      live = false;
    };
  }, [amountsKey, feeTry, phase, quoteSend]);

  const totals = planTotals(lines, fees);
  const affordable = affordability(totals.totalMinor, store.balance);
  const canConfirm = !loading && lines.length > 0 && affordable.state === 'enough';

  // No leaving while payments are going out.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: phase !== 'running' });
    if (phase !== 'running') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [navigation, phase]);

  // `all` is everyone in this run (kept on screen); `targets` is who to pay now —
  // the same people the first time, only the ones not yet paid on a retry.
  async function start(targets: RunLine[], all: RunLine[] = targets) {
    setRunLines(all);
    setStates((current) => {
      const next = { ...current };
      for (const line of targets) next[line.id] = { status: 'waiting' };
      return next;
    });
    setStoppedForBalance(false);
    setPhase('running');

    const outcome = await runPayroll({
      lines: targets,
      // The only thing that moves money: the ordinary send, one person at a time.
      send: async (line) => {
        const contactId = oneOffId(line.code);
        if (!contactId) throw new Error("That payment code doesn't look right.");
        const receipt = await store.send({ contactId, amountMinor: line.amountMinor, note: 'Payroll' });
        return { id: receipt.id, feeMinor: receipt.feeMinor };
      },
      onState: (id, state) => setStates((current) => ({ ...current, [id]: state })),
    });
    setStoppedForBalance(outcome.stoppedForBalance);
    setPhase('done');
  }

  // ---------------------------------------------------------------- running / done

  if (phase !== 'choose') {
    const summary = summarise(runLines, states);
    const remaining = unsettled(runLines, states);
    const running = phase === 'running';
    const firstStopped = runLines.find((line) => states[line.id]?.status === 'failed');

    return (
      <Screen>
        <Header title={running ? 'Paying your team' : 'Payroll'} leading={running ? 'none' : 'back'} />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, paddingTop: 2 }}
        >
          <View className="px-1">
            <Text className="font-strong text-title text-ink">
              {running
                ? `Paying ${peopleWords(runLines.length)}`
                : remaining.length === 0
                  ? `Paid ${peopleWords(summary.settled)}`
                  : `${summary.settled} of ${runLines.length} paid`}
            </Text>
            <Text tabular className="mt-1 font-body text-label text-slate">
              {running
                ? 'One at a time. Each is paid only once it has really gone through.'
                : `${formatNaira(kobo(summary.paidMinor))} sent, ${formatNaira(kobo(summary.feeMinor))} in fees.`}
            </Text>
          </View>

          <View className="mt-5 gap-2">
            {runLines.map((line) => {
              const state = states[line.id] ?? { status: 'waiting' };
              return (
                <View key={line.id} className="rounded-row border border-line bg-card px-4 py-3">
                  <View className="flex-row items-center gap-3">
                    <StateMark state={state} />
                    <View className="min-w-0 flex-1">
                      <Text numberOfLines={1} className="font-strong text-body-sm text-ink">
                        {line.name}
                      </Text>
                      <Text className="font-body text-caption text-slate">
                        {state.status === 'waiting'
                          ? 'Waiting'
                          : state.status === 'paying'
                            ? 'Paying'
                            : state.status === 'settled'
                              ? 'Paid'
                              : "Didn't go through"}
                      </Text>
                    </View>
                    <Text tabular className="font-strong text-body-sm text-ink">
                      {formatNaira(kobo(line.amountMinor))}
                    </Text>
                  </View>
                  {state.status === 'failed' ? (
                    <Text className="mt-2 font-body text-label-sm text-halt">{state.message}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>

          {!running && stoppedForBalance ? (
            <View className="mt-5 rounded-row border border-line bg-card px-4 py-4">
              <Text className="font-strong text-body-sm text-ink">We stopped because the money ran out</Text>
              <Text className="mt-1 font-body text-label-sm text-slate">
                {firstStopped ? `${firstStopped.name} and everyone after them` : 'Everyone still waiting'} was not
                paid. Add money, then retry to pay them.
              </Text>
              <View className="mt-3 flex-row">
                <Button label="Add money" variant="secondary" width="hug" onPress={() => router.push('/add-money')} />
              </View>
            </View>
          ) : null}
        </ScrollView>

        <ActionBar>
          {running ? (
            <Button label="Paying…" disabled onPress={() => {}} />
          ) : remaining.length > 0 ? (
            <>
              <Button label="Done" variant="secondary" onPress={() => router.back()} />
              <Button
                label={
                  summary.failed > 0 && summary.waiting === 0
                    ? `Retry ${summary.failed} failed`
                    : `Retry ${remaining.length}`
                }
                onPress={() => void start(remaining, runLines)}
              />
            </>
          ) : (
            <>
              <Button label="See activity" variant="secondary" onPress={() => router.push('/activity')} />
              <Button label="Done" onPress={() => router.back()} />
            </>
          )}
        </ActionBar>
      </Screen>
    );
  }

  // ---------------------------------------------------------------- choosing

  return (
    <View className="flex-1">
      <Screen>
        <Header title="Run payroll" />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, paddingTop: 2 }}
        >
          {loading ? (
            <View className="gap-2.5">
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </View>
          ) : people.length === 0 ? (
            <View className="rounded-row border border-line bg-card px-4 py-4">
              <Text className="font-strong text-body-sm text-ink">No one to pay yet</Text>
              <Text className="mt-1 font-body text-label-sm text-slate">
                Add your team first, by hand or from a spreadsheet.
              </Text>
              <View className="mt-3 flex-row">
                <Button
                  label="Add people"
                  variant="secondary"
                  width="hug"
                  onPress={() => router.replace('/business/payroll')}
                />
              </View>
            </View>
          ) : (
            <View>
              <View className="flex-row items-baseline justify-between px-1">
                <Text className="font-strong text-body-sm text-ink">Who are you paying?</Text>
                <Text tabular className="font-body text-caption text-slate">
                  You have {formatNaira(store.balance)}
                </Text>
              </View>
              <Text className="mt-1 px-1 font-body text-caption text-slate">
                Tap a person to include them. Tap an amount to change it for this run only.
              </Text>

              <View className="mt-4 gap-2">
                {people.map(({ person, amountMinor, problem, chosen }) => (
                  <View
                    key={person.id}
                    className={`flex-row items-center gap-3 rounded-row border bg-card px-3.5 py-3 ${
                      chosen ? 'border-indigo' : 'border-line'
                    }`}
                  >
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: chosen }}
                      accessibilityLabel={`Pay ${person.name}`}
                      onPress={() =>
                        setDropped((current) => {
                          const next = new Set(current);
                          if (next.has(person.id)) next.delete(person.id);
                          else next.add(person.id);
                          return next;
                        })
                      }
                      className="min-w-0 flex-1 flex-row items-center gap-3"
                    >
                      <View
                        className={`h-6 w-6 items-center justify-center rounded-md border ${
                          chosen ? 'border-indigo bg-indigo' : 'border-line bg-paper'
                        }`}
                      >
                        {chosen ? <Check size={15} strokeWidth={2.5} color={colors.card} /> : null}
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text numberOfLines={1} className="font-strong text-body-sm text-ink">
                          {person.name}
                        </Text>
                        {problem ? (
                          <Text numberOfLines={2} className="font-body text-caption text-caution">
                            {problem}
                          </Text>
                        ) : person.note ? (
                          <Text numberOfLines={1} className="font-body text-caption text-slate">
                            {person.note}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Change ${person.name}'s amount`}
                      hitSlop={8}
                      onPress={() => setEditing(person.id)}
                      className="rounded-chip bg-track px-3 py-2 active:bg-press"
                    >
                      <Text tabular className={`font-strong text-body-sm ${amountMinor > 0 ? 'text-ink' : 'text-indigo'}`}>
                        {amountMinor > 0 ? formatNaira(kobo(amountMinor)) : 'Set amount'}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </View>

              <View className="mt-6 rounded-row border border-line bg-card px-4 py-1.5">
                <SummaryLine label={`Paying ${peopleWords(lines.length)}`}>
                  <Text tabular className="font-strong text-label text-ink">
                    {formatNaira(kobo(totals.payMinor))}
                  </Text>
                </SummaryLine>
                <View className="h-px bg-hairline" />
                <SummaryLine label="Fees">
                  {totals.feeMinor === null && lines.length > 0 && !feeProblem ? (
                    <Skeleton className="h-4 w-20 rounded-md" />
                  ) : (
                    <Text tabular className="font-strong text-label text-ink">
                      {totals.feeMinor === null ? '—' : formatNaira(kobo(totals.feeMinor))}
                    </Text>
                  )}
                </SummaryLine>
                <View className="h-px bg-hairline" />
                <SummaryLine label="Total from you" strong>
                  {totals.totalMinor === null && lines.length > 0 && !feeProblem ? (
                    <Skeleton className="h-5 w-24 rounded-md" />
                  ) : (
                    <Text tabular className="font-heavy text-body-sm text-ink">
                      {totals.totalMinor === null ? '—' : formatNaira(kobo(totals.totalMinor))}
                    </Text>
                  )}
                </SummaryLine>
              </View>

              {feeProblem ? (
                <View className="mt-3 px-1">
                  <Text className="font-body text-label-sm text-halt">{feeProblem}</Text>
                  <Pressable accessibilityRole="button" hitSlop={10} onPress={() => setFeeTry((count) => count + 1)}>
                    <Text className="mt-1 font-strong text-label-sm text-indigo">Try again</Text>
                  </Pressable>
                </View>
              ) : affordable.state === 'short' ? (
                <View className="mt-3 px-1">
                  <Text tabular className="font-body text-label-sm text-caution">
                    You are {shortByWords(affordable.shortByMinor)} short of the total with fees.
                  </Text>
                  <Pressable accessibilityRole="link" hitSlop={10} onPress={() => router.push('/add-money')}>
                    <Text className="mt-1 font-strong text-label-sm text-indigo">Add money first</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          )}
        </ScrollView>

        <ActionBar>
          <Button
            label={lines.length > 0 ? `Confirm and pay ${peopleWords(lines.length)}` : 'Choose who to pay'}
            disabled={!canConfirm}
            onPress={() => void start(lines)}
          />
        </ActionBar>
      </Screen>

      {editing ? (
        <AmountSheet
          title={`Pay ${people.find((row) => row.person.id === editing)?.person.name ?? 'them'}`}
          hint="For this run only. Their regular pay stays as it is."
          current={amounts[editing] ?? people.find((row) => row.person.id === editing)?.amountMinor ?? 0}
          setLabel="Use this amount"
          onSet={(next) => {
            setAmounts((current) => ({ ...current, [editing]: next }));
            setEditing(null);
          }}
          onDismiss={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}

/** Where a line stands. Paying is a pulsing dot, not a spinner. */
function StateMark({ state }: { state: PayState }) {
  const colors = useThemeColors();
  if (state.status === 'settled') {
    return (
      <View className="h-7 w-7 items-center justify-center rounded-pill bg-settled-wash">
        <Check size={15} strokeWidth={2.5} color={colors.settled.DEFAULT} />
      </View>
    );
  }
  if (state.status === 'failed') {
    return (
      <View className="h-7 w-7 items-center justify-center rounded-pill bg-halt-wash">
        <X size={15} strokeWidth={2.5} color={colors.halt.DEFAULT} />
      </View>
    );
  }
  if (state.status === 'paying') {
    return (
      <View className="h-7 w-7 items-center justify-center">
        <Skeleton className="h-4 w-4 rounded-pill" />
      </View>
    );
  }
  return (
    <View className="h-7 w-7 items-center justify-center">
      <View className="h-3.5 w-3.5 rounded-pill border border-mist" />
    </View>
  );
}
