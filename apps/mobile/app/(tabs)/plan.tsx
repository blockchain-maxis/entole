import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { affordCheck, type AffordCheck, type MoneyPicture } from '@entole/core/money-picture';
import { useMoneyPicture } from '@entole/core/money-picture-hook';
import { kobo } from '@entole/core/money';
import { NearClientError, type StatementReading } from '@entole/core/near-client';
import { SPENDING_KIND_WORDS } from '@entole/core/statement';
import { TAX_BANDS_CONFIRMED } from '@entole/core/tax-ng';

import { Amount } from '@/components/ui/Amount';
import { AmountSheet } from '@/components/ui/AmountSheet';
import { Button } from '@/components/ui/Button';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { Header } from '@/components/ui/Header';
import { LogoLoader } from '@/components/ui/LogoLoader';
import { PasswordSheet } from '@/components/ui/PasswordSheet';
import { PauseButton } from '@/components/ui/PauseButton';
import { BalanceCheckLine, KeptProofLine, ProofPanel } from '@/components/ui/ProofPanel';
import { DetailRow, SectionHeading } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { pickPdf } from '@/lib/pick-file';
import {
  affordWords,
  dayWords,
  naira,
  percentWords,
  periodWords,
  runwayWords,
  safeUntilWords,
  suggestionRow,
  THIN_WORDS,
} from '@/lib/plan-words';
import { plainMessage } from '@/lib/send';
import { useThemeColors } from '@/lib/theme';

/**
 * Plan: the financial friend. A bank statement is read in sealed hardware on
 * NEAR AI Cloud, the proof of that is checked and shown, and what comes back
 * is kept on this phone only. From those lines and the person's Entole
 * activity the phone works out where they stand: what is safe to spend today,
 * money in and out, subscriptions, small leaks, how long the money lasts,
 * whether something is affordable, and roughly what tax is owed.
 *
 * Every figure is the person's own. A figure that cannot be worked out
 * honestly says why, and nothing is filled in.
 */

type Phase =
  | { kind: 'idle' }
  | { kind: 'reading'; fileName: string }
  | { kind: 'password'; fileName: string; bytes: Uint8Array; message: string; wrong: boolean }
  | { kind: 'failed'; message: string }
  | { kind: 'read'; reading: StatementReading };

const UPDATE_NEEDED = 'Reading a statement needs the updated app.';

export default function Plan() {
  const router = useRouter();
  const money = useMoneyPicture();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [afford, setAfford] = useState<{ amountMinor: number; check: AffordCheck | null } | null>(null);
  const [affordOpen, setAffordOpen] = useState(false);
  const [forgetOpen, setForgetOpen] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [forgetProblem, setForgetProblem] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const sections = useRef<Record<'subscriptions' | 'leaks', number>>({ subscriptions: 0, leaks: 0 });

  async function read(fileName: string, bytes: Uint8Array, password?: string) {
    setPhase({ kind: 'reading', fileName });
    try {
      const reading = await money.importStatement(bytes, password);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAfford(null);
      setPhase({ kind: 'read', reading });
    } catch (error) {
      if (error instanceof NearClientError && (error.code === 'needs_password' || error.code === 'wrong_password')) {
        setPhase({ kind: 'password', fileName, bytes, message: error.message, wrong: error.code === 'wrong_password' });
        return;
      }
      setPhase({ kind: 'failed', message: plainMessage(error, "We couldn't read that statement. Try again.") });
    }
  }

  async function choose() {
    try {
      const picked = await pickPdf();
      if (picked === 'unavailable') {
        setPhase({ kind: 'failed', message: UPDATE_NEEDED });
        return;
      }
      if (!picked) return;
      await read(picked.name, picked.bytes);
    } catch (error) {
      setPhase({ kind: 'failed', message: plainMessage(error, "We couldn't open that file. Try another one.") });
    }
  }

  async function forget() {
    setForgetting(true);
    setForgetProblem(null);
    try {
      await money.forget();
      setPhase({ kind: 'idle' });
      setAfford(null);
      setForgetOpen(false);
    } catch (error) {
      setForgetProblem(plainMessage(error, "We couldn't forget them just now. Try again."));
    } finally {
      setForgetting(false);
    }
  }

  function jumpTo(section: 'subscriptions' | 'leaks') {
    scroll.current?.scrollTo({ y: Math.max(0, sections.current[section] - 12), animated: true });
  }

  const picture = money.picture;
  const reading = phase.kind === 'reading';

  return (
    <View className="flex-1">
      <Screen edges={{ bottom: false }}>
        <Header title="Plan" leading="none" trailing={<PauseButton />} />

        <ScrollView
          ref={scroll}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {money.status === 'loading' ? (
            <PlanSkeleton />
          ) : reading ? (
            <Reading fileName={phase.fileName} />
          ) : (
            <Animated.View entering={FadeIn.duration(280)}>
              {phase.kind === 'failed' ? (
                <View accessibilityRole="alert" className="mb-2 rounded-control bg-halt-wash px-4 py-3">
                  <Text className="font-body text-ui text-ink">{phase.message}</Text>
                </View>
              ) : null}

              {!money.latest ? (
                <StartHere onRead={() => void choose()} hasPicture={Boolean(picture)} />
              ) : null}

              {phase.kind === 'read' ? (
                <View className="pt-2">
                  <ProofPanel proof={phase.reading.proof} />
                  <BalanceCheckLine check={phase.reading.reconciliation} />
                </View>
              ) : money.latest ? (
                <View className="pt-2">
                  <KeptProofLine latest={money.latest} />
                  <BalanceCheckLine
                    check={{
                      status: money.latest.status,
                      ...(money.latest.differenceMinor !== undefined ? { differenceMinor: money.latest.differenceMinor } : {}),
                    }}
                  />
                </View>
              ) : null}

              {picture ? (
                <PictureSections
                  picture={picture}
                  bankFigureFrom={money.latest?.closingMinor !== undefined ? money.latest.to : null}
                  afford={afford}
                  onAfford={() => setAffordOpen(true)}
                  onSections={(section, y) => {
                    sections.current[section] = y;
                  }}
                  onSuggestion={(row) => {
                    if (row.action === 'savings') {
                      router.push({
                        pathname: '/grow/savings',
                        params: { mode: 'deposit', ...(row.amountMinor ? { amount: String(row.amountMinor) } : {}) },
                      });
                    } else {
                      jumpTo(row.action);
                    }
                  }}
                />
              ) : null}

              {money.latest ? (
                <View className="mt-10 border-t border-hairline">
                  <RowButton label="Read another statement" caption="Adds to what is kept, up to six months" onPress={() => void choose()} />
                  <RowButton
                    label="Forget my statements"
                    caption="Removes them from this phone"
                    danger
                    onPress={() => {
                      setForgetProblem(null);
                      setForgetOpen(true);
                    }}
                  />
                </View>
              ) : null}
            </Animated.View>
          )}
        </ScrollView>
      </Screen>

      {phase.kind === 'password' ? (
        <PasswordSheet
          fileName={phase.fileName}
          message={phase.message}
          wrong={phase.wrong}
          onSubmit={(password) => void read(phase.fileName, phase.bytes, password)}
          onDismiss={() => setPhase({ kind: 'idle' })}
        />
      ) : null}

      {affordOpen && picture ? (
        <AmountSheet
          title="Can I afford it?"
          hint="Type what it costs. Nothing is spent."
          current={afford?.amountMinor ?? 0}
          setLabel="Check"
          onSet={(amountMinor) => {
            setAfford({ amountMinor, check: affordCheck(picture, amountMinor) });
            setAffordOpen(false);
          }}
          onDismiss={() => setAffordOpen(false)}
        />
      ) : null}

      {forgetOpen ? (
        <ConfirmSheet
          title="Forget your statements?"
          body="What was read from them is removed from this phone, and Plan starts again. Your balance and payments are not touched."
          confirmLabel="Forget them"
          tone="danger"
          busy={forgetting}
          problem={forgetProblem}
          onConfirm={() => void forget()}
          onDismiss={() => setForgetOpen(false)}
        />
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------- states

function PlanSkeleton() {
  return (
    <View accessibilityLabel="Loading" className="pt-2">
      <Skeleton className="h-4 w-40 rounded-md" />
      <View className="mt-6 rounded-card bg-card p-6 shadow-raised">
        <Skeleton className="h-4 w-32 rounded-md" />
        <Skeleton className="mt-4 h-[48px] w-48 rounded-control" />
        <Skeleton className="mt-3 h-4 w-56 rounded-md" />
      </View>
      {[0, 1].map((section) => (
        <View key={section} className="pt-10">
          <Skeleton className="h-5 w-28 rounded-md" />
          <Skeleton className="mt-5 h-4 w-full rounded-md" />
          <Skeleton className="mt-4 h-4 w-full rounded-md" />
        </View>
      ))}
    </View>
  );
}

/** The one wait whose end has no known shape: the mark turns while the reader works. */
function Reading({ fileName }: { fileName: string }) {
  return (
    <View accessibilityLiveRegion="polite" className="items-center px-4 pb-10 pt-20">
      <LogoLoader size={52} label="Reading your statement" />
      <Text className="mt-6 text-center font-display text-subhead text-ink">Reading in sealed hardware…</Text>
      <Text numberOfLines={1} className="mt-2 text-center font-body text-note text-slate">
        {fileName}
      </Text>
      <Text className="mt-4 text-center font-body text-ui text-slate">
        This takes up to a minute. The reader keeps nothing, and the proof is checked before anything is sent to it.
      </Text>
    </View>
  );
}

/** What Plan is for, and the one thing that starts it. */
function StartHere({ onRead, hasPicture }: { onRead: () => void; hasPicture: boolean }) {
  return (
    <View className="pt-2">
      <Text accessibilityRole="header" className="font-display text-heading text-ink">
        See what is safe to spend
      </Text>
      <Text className="mt-3 font-body text-prose text-slate">
        Read a bank statement and Entole works out what you can spend each day, where small payments add up, what
        your subscriptions cost and roughly what tax you owe.
      </Text>
      <View className="mt-5 border-y border-hairline py-3">
        <Text className="font-body text-note text-slate">
          It is read in sealed hardware that nobody can look into, and the proof is checked on the way. What comes back
          stays on this phone.
        </Text>
      </View>
      <View className="mt-5 flex-row">
        <Button label="Read a bank statement" onPress={onRead} />
      </View>
      <Text className="mt-3 font-body text-note text-slate">
        The PDF your bank sends, up to 5 MB. If it has a password, you will be asked for it.
      </Text>
      {hasPicture ? (
        <Text className="mt-6 font-body text-note text-slate">
          Below is what your Entole payments alone show. A statement fills in the rest.
        </Text>
      ) : null}
    </View>
  );
}

function RowButton({ label, caption, onPress, danger = false }: { label: string; caption: string; onPress: () => void; danger?: boolean }) {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="min-h-[56px] flex-row items-center gap-3 border-b border-hairline py-3.5 active:bg-press"
    >
      <View className="min-w-0 flex-1">
        <Text className={`font-strong text-ui ${danger ? 'text-halt' : 'text-ink'}`}>{label}</Text>
        <Text className="mt-0.5 font-body text-note text-slate">{caption}</Text>
      </View>
      <ChevronRight size={16} strokeWidth={1.5} color={colors.mist} />
    </Pressable>
  );
}

/** A line that says why a figure is not there. */
function Missing({ children }: { children: string }) {
  return <Text className="border-b border-hairline py-3.5 font-body text-ui text-slate">{children}</Text>;
}

// ------------------------------------------------------------------ the picture

function PictureSections({
  picture,
  bankFigureFrom,
  afford,
  onAfford,
  onSections,
  onSuggestion,
}: {
  picture: MoneyPicture;
  bankFigureFrom: string | null;
  afford: { amountMinor: number; check: AffordCheck | null } | null;
  onAfford: () => void;
  onSections: (section: 'subscriptions' | 'leaks', y: number) => void;
  onSuggestion: (row: ReturnType<typeof suggestionRow>) => void;
}) {
  const colors = useThemeColors();
  const safe = picture.safeToSpend;
  const answer = afford?.check ? affordWords(afford.check) : null;

  return (
    <View>
      <Text tabular className="mt-6 font-body text-note text-slate">
        {periodWords(picture.from, picture.to)}
        {bankFigureFrom ? ` · bank figure from ${dayWords(bankFigureFrom)}` : ''}
      </Text>

      {/* The one raised surface: what the screen is about. */}
      <View className="mt-3 rounded-card bg-card p-6 shadow-raised">
        <Text className="font-strong text-note text-slate">Safe to spend today</Text>
        {safe ? (
          <>
            <View className="mt-3">
              <Amount value={kobo(safe.todayMinor)} size="large" />
            </View>
            <Text className="mt-2 font-body text-ui text-slate">A day, {safeUntilWords(picture)}.</Text>
            <View className="mt-4 border-t border-hairline">
              {safe.committedMinor - safe.savingsSetAsideMinor - safe.taxSetAsideMinor > 0 ? (
                <DetailRow label="Bills due before then" value={naira(safe.committedMinor - safe.savingsSetAsideMinor - safe.taxSetAsideMinor)} />
              ) : null}
              {safe.savingsSetAsideMinor > 0 ? <DetailRow label="Kept for savings" value={naira(safe.savingsSetAsideMinor)} /> : null}
              {safe.taxSetAsideMinor > 0 ? <DetailRow label="Kept for tax" value={naira(safe.taxSetAsideMinor)} /> : null}
            </View>
          </>
        ) : (
          <Text className="mt-2 font-body text-ui text-slate">
            {picture.thin ? THIN_WORDS : 'Shows once a bank closing figure or your Entole balance is known.'}
          </Text>
        )}
      </View>

      <SectionHeading title="Money in" />
      {picture.income.monthlyMinor > 0 ? (
        <View>
          <DetailRow label="A month, usually" value={naira(picture.income.monthlyMinor)} />
          <DetailRow
            label="Next expected"
            value={picture.income.nextExpected ? dayWords(picture.income.nextExpected) : 'No regular date yet'}
            tabular={false}
          />
          {picture.income.sources.slice(0, 3).map((source) => (
            <DetailRow
              key={source.name}
              label={`${source.name}${source.monthly ? ' · monthly' : ''}`}
              value={naira(source.totalMinor)}
            />
          ))}
        </View>
      ) : (
        <Missing>{picture.thin ? THIN_WORDS : 'No income seen in these lines yet.'}</Missing>
      )}

      <SectionHeading title="Money out" />
      {picture.out.monthlyMinor > 0 ? (
        <View>
          <DetailRow label="A month, usually" value={naira(picture.out.monthlyMinor)} />
          {picture.byKind.slice(0, 6).map((kind) => (
            <View key={kind.kind} className="border-b border-hairline py-3">
              <View className="flex-row items-center justify-between gap-4">
                <Text className="flex-1 font-body text-ui text-ink">{SPENDING_KIND_WORDS[kind.kind]}</Text>
                <Text tabular className="font-strong text-ui text-ink">
                  {naira(kind.monthlyMinor)}
                </Text>
              </View>
              {/* A plain bar of its share, in ink. */}
              <View className="mt-2 h-1 overflow-hidden rounded-pill bg-press">
                <View className="h-1 rounded-pill bg-ink" style={{ width: `${Math.max(2, kind.shareBps / 100)}%` }} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <Missing>{picture.thin ? THIN_WORDS : 'No spending seen in these lines yet.'}</Missing>
      )}

      <View onLayout={(event) => onSections('subscriptions', event.nativeEvent.layout.y)}>
        <SectionHeading title="Subscriptions" />
        {picture.subscriptions.count > 0 ? (
          <View>
            {picture.subscriptions.items.map((item) => (
              <View key={item.key} className="flex-row items-center justify-between gap-4 border-b border-hairline py-3">
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="font-strong text-ui text-ink">
                    {item.name}
                  </Text>
                  <Text className="mt-0.5 font-body text-note text-slate">Next about {dayWords(item.nextDate)}</Text>
                </View>
                <Text tabular className="font-strong text-ui text-ink">
                  {naira(item.typicalMinor)}
                </Text>
              </View>
            ))}
            <DetailRow label="Together, a month" value={naira(picture.subscriptions.monthlyMinor)} />
          </View>
        ) : (
          <Missing>{picture.thin ? THIN_WORDS : 'No subscriptions found. One shows after it is paid twice, a month apart.'}</Missing>
        )}
      </View>

      <View onLayout={(event) => onSections('leaks', event.nativeEvent.layout.y)}>
        <SectionHeading title="Small leaks" />
        {picture.leaks.count > 0 ? (
          <View>
            <Text className="pb-2 font-body text-ui text-slate">
              {picture.leaks.count} payments under {naira(picture.leaks.thresholdMinor)} in the last {picture.leaks.days}{' '}
              days came to {naira(picture.leaks.totalMinor)}
              {picture.leaks.shareOfIncomeBps !== null ? `, ${percentWords(picture.leaks.shareOfIncomeBps)} of a month's income` : ''}.
            </Text>
            {picture.leaks.top.slice(0, 5).map((payee) => (
              <View key={payee.name} className="flex-row items-center justify-between gap-4 border-b border-hairline py-3">
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="font-strong text-ui text-ink">
                    {payee.name}
                  </Text>
                  <Text className="mt-0.5 font-body text-note text-slate">
                    {payee.count} {payee.count === 1 ? 'time' : 'times'}
                  </Text>
                </View>
                <Text tabular className="font-strong text-ui text-ink">
                  {naira(payee.totalMinor)}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Missing>No small payments adding up in the last month.</Missing>
        )}
      </View>

      <SectionHeading title="How long your money lasts" />
      {picture.runwayMonths !== null ? (
        <View className="border-b border-hairline pb-3.5">
          <Text className="font-display text-subhead text-ink">{runwayWords(picture.runwayMonths)}</Text>
          <Text className="mt-1 font-body text-note text-slate">At your usual spending, with nothing coming in.</Text>
        </View>
      ) : (
        <Missing>{picture.thin ? THIN_WORDS : 'Shows once your spending and a balance are both known.'}</Missing>
      )}

      <SectionHeading title="Can I afford it?" />
      {afford ? (
        <View accessibilityLiveRegion="polite" className="border-b border-hairline pb-4">
          <Text tabular className="font-body text-note text-slate">
            {naira(afford.amountMinor)}
          </Text>
          {answer ? (
            <>
              <Text
                className={`mt-1 font-display text-subhead ${
                  afford.check?.verdict === 'not-now' ? 'text-halt' : afford.check?.verdict === 'tight' ? 'text-ink' : 'text-settled'
                }`}
              >
                {answer.headline}
              </Text>
              <Text className="mt-1 font-body text-ui text-slate">{answer.detail}</Text>
            </>
          ) : (
            <Text className="mt-1 font-body text-ui text-slate">{picture.thin ? THIN_WORDS : 'We need a balance to answer that.'}</Text>
          )}
        </View>
      ) : (
        <Text className="pb-1 font-body text-ui text-slate">Type a price and see what it does to the weeks ahead.</Text>
      )}
      <View className="mt-3 flex-row">
        <Button label={afford ? 'Check another amount' : 'Check an amount'} variant="secondary" width="hug" onPress={onAfford} />
      </View>

      <SectionHeading title="Tax estimate" />
      {picture.tax ? (
        <View>
          <DetailRow label="A month" value={naira(picture.tax.monthlyTaxMinor)} />
          <DetailRow label="A year" value={naira(picture.tax.yearlyTaxMinor)} />
          <DetailRow label="Of your income" value={percentWords(picture.tax.effectiveBps)} />
          <Text className="mt-2 font-body text-note text-slate">
            Estimate under the 2026 rules, not a filing.
            {TAX_BANDS_CONFIRMED ? '' : ' The 2026 bands are still being confirmed.'}
          </Text>
        </View>
      ) : (
        <Missing>{picture.thin ? THIN_WORDS : 'Shows once income is seen in your statements.'}</Missing>
      )}

      {picture.suggestions.length > 0 ? (
        <View>
          <SectionHeading title="Worth doing" />
          <View className="border-t border-hairline">
            {picture.suggestions.map((suggestion) => {
              const row = suggestionRow(suggestion);
              return (
                <Pressable
                  key={suggestion.kind}
                  accessibilityRole="button"
                  accessibilityLabel={row.title}
                  onPress={() => onSuggestion(row)}
                  className="min-h-[56px] flex-row items-center gap-3 border-b border-hairline py-3.5 active:bg-press"
                >
                  <View className="min-w-0 flex-1">
                    <Text className="font-strong text-ui text-ink">{row.title}</Text>
                    <Text className="mt-0.5 font-body text-note text-slate">{row.caption}</Text>
                  </View>
                  <ChevronRight size={16} strokeWidth={1.5} color={colors.mist} />
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}
