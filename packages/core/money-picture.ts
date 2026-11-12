import type { Activity } from './schemas';
import { estimateIncomeTax, type TaxEstimate } from './tax-ng';
import type { SpendingKind, StatementLine } from './statement';

/**
 * The money picture: where a person stands, built only from their own lines
 * (their bank statements and their Entole activity). Every figure here is
 * arithmetic on those lines. Where the lines are too few to say something
 * honestly, the figure is null and the screen says so; nothing is filled in
 * with an average from elsewhere.
 *
 * Pure: no network, no clock (today is passed in), integer kobo throughout.
 */

const DAY_MS = 86_400_000;
const AVERAGE_MONTH_DAYS = 30.44;

const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const dayString = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
};

// ------------------------------------------------------------ the lines

/** Entole's own activity as statement lines, so both sources read as one. */
export function activityToLines(activity: readonly Activity[], nameOf: (contactId: string) => string): StatementLine[] {
  return activity
    .filter((item) => item.state === 'settled' && item.amountMinor > 0)
    .map((item) => ({
      date: item.at.slice(0, 10),
      description: item.note || nameOf(item.contactId),
      merchant: nameOf(item.contactId),
      kind: (item.direction === 'in' ? 'transfer-in' : 'transfer-out') as SpendingKind,
      direction: item.direction,
      amountMinor: item.amountMinor,
    }));
}

/** A name that groups the same payee written different ways. */
export function payeeKey(line: Pick<StatementLine, 'merchant' | 'description'>): string {
  const base = (line.merchant || line.description).toLowerCase();
  return base
    .replace(/\b(pos|web|nip|trf|transfer|to|from|ref|purchase|payment|debit|credit|via|ussd|mob|app)\b/g, ' ')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3)
    .join(' ');
}

/** Kinds that are committed costs rather than choices. */
const FIXED_KINDS: readonly SpendingKind[] = ['rent-home', 'power', 'data-airtime', 'education', 'health', 'tax'];
/** Kinds where small, frequent payments add up unnoticed. */
const LEAK_KINDS: readonly SpendingKind[] = ['food', 'transport', 'data-airtime', 'shopping', 'entertainment', 'subscriptions', 'bank-fees', 'cash', 'other'];
/** Kinds that are not spending: money moved between one's own places. */
const NOT_SPENDING: readonly SpendingKind[] = ['savings-investing'];

// ---------------------------------------------------------- recurring

/** The same day next month, or that month's last day: 31 January → 28 February. */
export function nextMonthDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date, last))).toISOString().slice(0, 10);
}

export type Recurring = {
  key: string;
  name: string;
  kind: SpendingKind;
  typicalMinor: number;
  count: number;
  lastDate: string;
  nextDate: string;
  subscription: boolean;
  fixed: boolean;
};

/**
 * Payments to the same payee, at about the same amount, about a month apart,
 * at least twice. Amounts within 15% of the middle one; gaps of 25 to 35 days.
 */
export function findRecurring(lines: readonly StatementLine[], direction: 'in' | 'out' = 'out'): Recurring[] {
  const groups = new Map<string, StatementLine[]>();
  for (const line of lines) {
    if (line.direction !== direction) continue;
    const key = payeeKey(line);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  const found: Recurring[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const typical = median(group.map((line) => line.amountMinor));
    const near = group.filter((line) => Math.abs(line.amountMinor - typical) <= typical * 0.15);
    const days = [...new Set(near.map((line) => dayNumber(line.date)))].sort((a, b) => a - b);
    if (days.length < 2) continue;
    const gaps = days.slice(1).map((day, index) => day - days[index]!);
    if (!gaps.every((gap) => gap >= 25 && gap <= 35)) continue;
    const last = near.reduce((a, b) => (a.date > b.date ? a : b));
    const kind = last.kind;
    found.push({
      key,
      name: last.merchant || last.description,
      kind,
      typicalMinor: typical,
      count: days.length,
      lastDate: dayString(days.at(-1)!),
      nextDate: nextMonthDay(dayString(days.at(-1)!)),
      subscription: kind === 'subscriptions',
      fixed: FIXED_KINDS.includes(kind) || kind === 'subscriptions',
    });
  }
  return found.sort((a, b) => b.typicalMinor - a.typicalMinor);
}

// --------------------------------------------------------- the picture

export type IncomeSource = { name: string; totalMinor: number; count: number; lastDate: string; monthly: boolean };

export type KindTotal = { kind: SpendingKind; totalMinor: number; monthlyMinor: number; shareBps: number };

export type Leaks = {
  thresholdMinor: number;
  days: number;
  count: number;
  totalMinor: number;
  /** Share of a month's income, in basis points; null without income. */
  shareOfIncomeBps: number | null;
  top: { name: string; count: number; totalMinor: number }[];
};

export type Suggestion =
  | { kind: 'save-underspend'; amountMinor: number; underMinor: number }
  | { kind: 'review-subscriptions'; count: number; monthlyMinor: number }
  | { kind: 'small-leaks'; totalMinor: number; count: number }
  | { kind: 'thin-buffer'; runwayMonths: number }
  | { kind: 'set-aside-tax'; monthlyMinor: number };

export type MoneyPicture = {
  from: string;
  to: string;
  days: number;
  /** Too little to read a pattern from: under four weeks of lines. */
  thin: boolean;
  balanceMinor: number | null;
  income: { totalMinor: number; monthlyMinor: number; sources: IncomeSource[]; nextExpected: string | null; regular: boolean };
  out: { totalMinor: number; monthlyMinor: number };
  netMonthlyMinor: number;
  byKind: KindTotal[];
  recurring: Recurring[];
  subscriptions: { count: number; monthlyMinor: number; items: Recurring[] };
  /** Months the balance lasts at the usual spending, with nothing coming in. */
  runwayMonths: number | null;
  safeToSpend: SafeToSpend | null;
  leaks: Leaks;
  tax: TaxEstimate | null;
  suggestions: Suggestion[];
};

export type SafeToSpend = {
  todayMinor: number;
  /** Days until the next expected income, or to the month's end when there is none. */
  days: number;
  untilIncome: boolean;
  committedMinor: number;
  dueBeforeIncome: Recurring[];
  savingsSetAsideMinor: number;
  taxSetAsideMinor: number;
};

export type PictureSettings = {
  /** Share of income set aside for savings before anything is safe to spend. */
  savingsBps: number;
  /** True when tax is already taken from pay (PAYE); then none is set aside here. */
  taxedAtSource: boolean;
};

export const DEFAULT_PICTURE_SETTINGS: PictureSettings = { savingsBps: 1000, taxedAtSource: false };

const LEAK_WINDOW_DAYS = 30;

export function buildMoneyPicture(input: {
  lines: readonly StatementLine[];
  balanceMinor: number | null;
  today: string;
  settings?: PictureSettings;
}): MoneyPicture | null {
  const settings = input.settings ?? DEFAULT_PICTURE_SETTINGS;
  const lines = [...input.lines].sort((a, b) => a.date.localeCompare(b.date));
  if (!lines.length) return null;
  const from = lines[0]!.date;
  const to = lines.at(-1)!.date;
  const days = dayNumber(to) - dayNumber(from) + 1;
  const months = Math.max(days / AVERAGE_MONTH_DAYS, 1 / AVERAGE_MONTH_DAYS);
  const thin = days < 28;

  const spending = lines.filter((line) => line.direction === 'out' && !NOT_SPENDING.includes(line.kind));
  const incoming = lines.filter((line) => line.direction === 'in' && (line.kind === 'income' || line.kind === 'transfer-in'));
  const earned = incoming.filter((line) => line.kind === 'income');

  const totalOut = spending.reduce((sum, line) => sum + line.amountMinor, 0);
  const totalIncome = earned.reduce((sum, line) => sum + line.amountMinor, 0);
  const monthlyOut = Math.round(totalOut / months);
  const monthlyIncome = Math.round(totalIncome / months);

  // Income sources and whether the main one arrives monthly.
  const incomeRecurring = findRecurring(earned, 'in');
  const sourceMap = new Map<string, IncomeSource>();
  for (const line of earned) {
    const key = payeeKey(line) || 'income';
    const source = sourceMap.get(key) ?? { name: line.merchant || line.description, totalMinor: 0, count: 0, lastDate: line.date, monthly: false };
    source.totalMinor += line.amountMinor;
    source.count += 1;
    source.lastDate = line.date > source.lastDate ? line.date : source.lastDate;
    source.monthly = incomeRecurring.some((item) => item.key === key);
    sourceMap.set(key, source);
  }
  const sources = [...sourceMap.values()].sort((a, b) => b.totalMinor - a.totalMinor);
  const nextIncome = incomeRecurring
    .map((item) => item.nextDate)
    .filter((day) => day >= input.today)
    .sort()[0] ?? null;

  // Spending by kind.
  const kindTotals = new Map<SpendingKind, number>();
  for (const line of spending) kindTotals.set(line.kind, (kindTotals.get(line.kind) ?? 0) + line.amountMinor);
  const byKind: KindTotal[] = [...kindTotals.entries()]
    .map(([kind, total]) => ({ kind, totalMinor: total, monthlyMinor: Math.round(total / months), shareBps: totalOut ? Math.round((total * 10_000) / totalOut) : 0 }))
    .sort((a, b) => b.totalMinor - a.totalMinor);

  const recurring = findRecurring(spending);
  const subscriptionItems = recurring.filter((item) => item.subscription);
  const subscriptions = {
    count: subscriptionItems.length,
    monthlyMinor: subscriptionItems.reduce((sum, item) => sum + item.typicalMinor, 0),
    items: subscriptionItems,
  };

  const runwayMonths = input.balanceMinor !== null && monthlyOut > 0 && !thin
    ? Math.round((Math.max(0, input.balanceMinor) / monthlyOut) * 10) / 10
    : null;

  // Tax: a yearly estimate from this income, unless it is taken at source.
  const yearlyRent = (kindTotals.get('rent-home') ?? 0) * (12 / months);
  const tax = monthlyIncome > 0 && !thin ? estimateIncomeTax({ yearlyIncomeMinor: monthlyIncome * 12, yearlyRentMinor: yearlyRent }) : null;
  const taxSetAside = tax && !settings.taxedAtSource ? tax.monthlyTaxMinor : 0;

  const safeToSpend = input.balanceMinor === null || thin
    ? null
    : safeToSpendFor({
      balanceMinor: input.balanceMinor,
      today: input.today,
      nextIncome,
      recurring,
      monthlyIncomeMinor: monthlyIncome,
      savingsBps: settings.savingsBps,
      taxMonthlyMinor: taxSetAside,
    });

  const leaks = findLeaks(spending, to, monthlyIncome);

  // Suggestions, each from a figure above.
  const suggestions: Suggestion[] = [];
  const recentStart = dayString(dayNumber(to) - LEAK_WINDOW_DAYS + 1);
  const earlier = spending.filter((line) => line.date < recentStart);
  const earlierDays = dayNumber(recentStart) - dayNumber(from);
  if (earlierDays >= 28) {
    const usualMonth = Math.round((earlier.reduce((sum, line) => sum + line.amountMinor, 0) / earlierDays) * LEAK_WINDOW_DAYS);
    const thisMonth = spending.filter((line) => line.date >= recentStart).reduce((sum, line) => sum + line.amountMinor, 0);
    const under = usualMonth - thisMonth;
    if (under > 0 && under >= usualMonth * 0.05) {
      suggestions.push({ kind: 'save-underspend', underMinor: under, amountMinor: Math.floor(under / 2 / 100_000) * 100_000 || Math.floor(under / 2 / 100) * 100 });
    }
  }
  if (subscriptions.count > 0) suggestions.push({ kind: 'review-subscriptions', count: subscriptions.count, monthlyMinor: subscriptions.monthlyMinor });
  if (leaks.count >= 8) suggestions.push({ kind: 'small-leaks', totalMinor: leaks.totalMinor, count: leaks.count });
  if (runwayMonths !== null && runwayMonths < 3) suggestions.push({ kind: 'thin-buffer', runwayMonths });
  if (taxSetAside > 0) suggestions.push({ kind: 'set-aside-tax', monthlyMinor: taxSetAside });

  return {
    from,
    to,
    days,
    thin,
    balanceMinor: input.balanceMinor,
    income: { totalMinor: totalIncome, monthlyMinor: monthlyIncome, sources, nextExpected: nextIncome, regular: incomeRecurring.length > 0 },
    out: { totalMinor: totalOut, monthlyMinor: monthlyOut },
    netMonthlyMinor: monthlyIncome - monthlyOut,
    byKind,
    recurring,
    subscriptions,
    runwayMonths,
    safeToSpend,
    leaks,
    tax,
    suggestions,
  };
}

function safeToSpendFor(input: {
  balanceMinor: number;
  today: string;
  nextIncome: string | null;
  recurring: readonly Recurring[];
  monthlyIncomeMinor: number;
  savingsBps: number;
  taxMonthlyMinor: number;
}): SafeToSpend {
  const today = dayNumber(input.today);
  const date = new Date(today * DAY_MS);
  const monthEnd = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / DAY_MS);
  const until = input.nextIncome ? dayNumber(input.nextIncome) : monthEnd;
  const days = Math.max(1, until - today);
  // A recurring cost is due again before the income if its next date falls in the window.
  const due = input.recurring.filter((item) => item.fixed && dayNumber(item.nextDate) >= today && dayNumber(item.nextDate) < until);
  const share = Math.min(1, days / AVERAGE_MONTH_DAYS);
  const savingsSetAsideMinor = Math.round(((input.monthlyIncomeMinor * input.savingsBps) / 10_000) * share);
  const taxSetAsideMinor = Math.round(input.taxMonthlyMinor * share);
  const committedMinor = due.reduce((sum, item) => sum + item.typicalMinor, 0) + savingsSetAsideMinor + taxSetAsideMinor;
  const free = Math.max(0, input.balanceMinor - committedMinor);
  return {
    todayMinor: Math.floor(free / days / 100) * 100,
    days,
    untilIncome: Boolean(input.nextIncome),
    committedMinor,
    dueBeforeIncome: due,
    savingsSetAsideMinor,
    taxSetAsideMinor,
  };
}

/**
 * Small payments over the last 30 days of lines. "Small" is tied to income:
 * 1.5% of a month's income, kept between ₦1,500 and ₦10,000; ₦5,000 without
 * income.
 */
export function findLeaks(spending: readonly StatementLine[], lastDay: string, monthlyIncomeMinor: number): Leaks {
  const thresholdMinor = monthlyIncomeMinor > 0
    ? Math.min(1_000_000, Math.max(150_000, Math.round(monthlyIncomeMinor * 0.015)))
    : 500_000;
  const start = dayString(dayNumber(lastDay) - LEAK_WINDOW_DAYS + 1);
  const small = spending.filter((line) => line.date >= start && line.amountMinor <= thresholdMinor && LEAK_KINDS.includes(line.kind));
  const groups = new Map<string, { name: string; count: number; totalMinor: number }>();
  for (const line of small) {
    const key = payeeKey(line) || line.kind;
    const group = groups.get(key) ?? { name: line.merchant || line.description, count: 0, totalMinor: 0 };
    group.count += 1;
    group.totalMinor += line.amountMinor;
    groups.set(key, group);
  }
  const totalMinor = small.reduce((sum, line) => sum + line.amountMinor, 0);
  return {
    thresholdMinor,
    days: LEAK_WINDOW_DAYS,
    count: small.length,
    totalMinor,
    shareOfIncomeBps: monthlyIncomeMinor > 0 ? Math.round((totalMinor * 10_000) / monthlyIncomeMinor) : null,
    top: [...groups.values()].sort((a, b) => b.totalMinor - a.totalMinor).slice(0, 5),
  };
}

// -------------------------------------------------------- can I afford it

export type AffordCheck = {
  amountMinor: number;
  /**
   * - `comfortable`: after it, what is committed is still covered and three
   *   months or more of spending remain.
   * - `tight`: committed costs are covered, but under three months remain.
   * - `not-now`: it would eat into money already committed before next income.
   */
  verdict: 'comfortable' | 'tight' | 'not-now';
  runwayBefore: number | null;
  runwayAfter: number | null;
  /** Days of usual saving it takes to earn back; null when nothing is left over each month. */
  daysToEarnBack: number | null;
  safeTodayAfterMinor: number | null;
  shortByMinor: number;
};

export function affordCheck(picture: MoneyPicture, amountMinor: number): AffordCheck | null {
  if (picture.balanceMinor === null || picture.thin) return null;
  const after = picture.balanceMinor - amountMinor;
  const committed = picture.safeToSpend?.committedMinor ?? 0;
  const runway = (balance: number) => (picture.out.monthlyMinor > 0 ? Math.round((Math.max(0, balance) / picture.out.monthlyMinor) * 10) / 10 : null);
  const runwayAfter = runway(after);
  const shortByMinor = Math.max(0, committed - after);
  const verdict: AffordCheck['verdict'] = shortByMinor > 0 ? 'not-now' : runwayAfter !== null && runwayAfter < 3 ? 'tight' : 'comfortable';
  const daily = picture.netMonthlyMinor / AVERAGE_MONTH_DAYS;
  const safe = picture.safeToSpend;
  return {
    amountMinor,
    verdict,
    runwayBefore: picture.runwayMonths,
    runwayAfter,
    daysToEarnBack: daily > 0 ? Math.ceil(amountMinor / daily) : null,
    safeTodayAfterMinor: safe ? Math.floor(Math.max(0, after - safe.committedMinor) / safe.days / 100) * 100 : null,
    shortByMinor,
  };
}
