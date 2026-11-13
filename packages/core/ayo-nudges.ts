import type { AssistantStep } from './assistant-actions';
import { dueReminders, type AyoMemory, type Goal } from './ayo-memory';
import { addDays, dayWords, daysBetween, firstNameOf, monthsWords, partOfDay, pick, whenWords } from './ayo-voice';
import { LEAK_KINDS, NOT_SPENDING, payeeKey, type MoneyPicture } from './money-picture';
import { formatNaira, kobo } from './money';
import type { Invoice } from './schemas';
import type { StatementLine } from './statement';

/**
 * Nudges: the few things worth saying to the person today, each from their
 * own figures, each with something Ayo can open or get ready.
 *
 * Income landed, so offer a share to savings. Spending ran under the usual
 * this week, so offer the difference. A subscription renews in a day or two.
 * Small payments are running above the usual. The buffer is thin. Tax for the
 * month. Money idle beyond a month of spending. An invoice overdue. A goal on
 * track or behind. A reminder that is due.
 *
 * Rules every nudge keeps:
 * - Every figure is arithmetic on the person's own lines, balance, savings,
 *   invoices and goals. A nudge whose inputs are missing is not made; nothing
 *   is filled in from elsewhere.
 * - Weekly comparisons need lines that reach today; an old statement says
 *   nothing about this week.
 * - At most three, the most useful first, and never one they said no to.
 * - The action only opens or gets something ready. Moving money is still the
 *   person's own confirmation.
 *
 * Pure: today is passed in, nothing is fetched.
 */

export type NudgeKind =
  | 'reminder-due'
  | 'income-landed'
  | 'renewing-soon'
  | 'invoice-overdue'
  | 'under-usual'
  | 'small-leaks'
  | 'runway-low'
  | 'goal'
  | 'tax-set-aside'
  | 'idle-money';

export type Nudge = {
  /** Stable for this occurrence, so a "not now" keeps it away and next month's comes back. */
  id: string;
  kind: NudgeKind;
  /** What happened or where they stand, in a sentence. */
  text: string;
  /** The offer, as a question, when there is one: "Want me to put ₦50,000 aside?" */
  ask: string | null;
  /** What the app opens or gets ready on a yes, and the button's words. */
  action: { label: string; step: AssistantStep } | null;
};

export type NudgeInput = {
  today: string;
  picture: MoneyPicture | null;
  /** The lines the picture was built from: statements and Entole activity. */
  lines: readonly StatementLine[] | null;
  /** The Entole balance, in kobo. */
  balanceMinor: number | null;
  /** In savings, in kobo; null where savings is not available to this account. */
  savingsMinor: number | null;
  invoices: readonly Invoice[];
  memory: AyoMemory;
};

export const MOST_NUDGES = 3;

const RANK: Record<NudgeKind, number> = {
  'reminder-due': 100,
  'income-landed': 90,
  'renewing-soon': 80,
  'invoice-overdue': 75,
  'under-usual': 70,
  'small-leaks': 65,
  'runway-low': 60,
  goal: 55,
  'tax-set-aside': 40,
  'idle-money': 30,
};

const naira = (minor: number) => formatNaira(kobo(minor));
/** Down to a round figure a person would say: whole thousands above ₦10,000, whole hundreds below. */
export const roundDown = (minor: number) => (minor >= 1_000_000 ? Math.floor(minor / 100_000) * 100_000 : Math.floor(minor / 10_000) * 10_000);

/** Monday of the week a day falls in. */
function mondayOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

const isSpending = (line: StatementLine) => line.direction === 'out' && !NOT_SPENDING.includes(line.kind);

/** Whether the lines reach close enough to today to say anything about this week. */
function fresh(lines: readonly StatementLine[], today: string): boolean {
  const last = lines.reduce<string | null>((latest, line) => (latest === null || line.date > latest ? line.date : latest), null);
  return last !== null && daysBetween(last, today) <= 2;
}

/**
 * This week so far against the usual for the same number of days, from the
 * weeks before it. Null with under four weeks of history before this week or
 * under three days into it.
 */
function weekAgainstUsual(lines: readonly StatementLine[], today: string, keep: (line: StatementLine) => boolean) {
  const monday = mondayOf(today);
  const daysIn = daysBetween(monday, today) + 1;
  const first = lines.reduce<string | null>((earliest, line) => (earliest === null || line.date < earliest ? line.date : earliest), null);
  if (!first || daysIn < 3) return null;
  const before = daysBetween(first, monday);
  if (before < 28) return null;
  const kept = lines.filter(keep);
  const thisWeek = kept.filter((line) => line.date >= monday && line.date <= today);
  const earlier = kept.filter((line) => line.date < monday);
  const sum = (list: readonly StatementLine[]) => list.reduce((total, line) => total + line.amountMinor, 0);
  return { monday, thisWeekMinor: sum(thisWeek), usualMinor: Math.round((sum(earlier) / before) * daysIn), thisWeek };
}

function incomeLanded(input: NudgeInput): Nudge | null {
  if (!input.lines || input.savingsMinor === null) return null;
  const monthly = input.picture?.income.monthlyMinor ?? 0;
  // Pay is a line read as income, or money in on Entole big enough to be pay rather than change.
  const big = Math.max(2_000_000, Math.round(monthly * 0.2));
  const landed = input.lines
    .filter((line) => line.direction === 'in' && (line.kind === 'income' || (line.kind === 'transfer-in' && line.amountMinor >= big)))
    .filter((line) => line.date <= input.today && daysBetween(line.date, input.today) <= 3)
    .sort((a, b) => b.date.localeCompare(a.date) || b.amountMinor - a.amountMinor)[0];
  if (!landed) return null;
  const shareBps = input.memory.savingsShareBps ?? 1000;
  const offer = roundDown(Math.floor((landed.amountMinor * shareBps) / 10_000));
  if (offer <= 0) return null;
  const who = landed.merchant || landed.description;
  const text = who ? `${who} paid ${naira(landed.amountMinor)}.` : `${naira(landed.amountMinor)} came in.`;
  return {
    id: `income:${landed.date}:${payeeKey(landed) || 'in'}`,
    kind: 'income-landed',
    text,
    ask: `Want me to put ${naira(offer)} aside?`,
    action: { label: `Save ${naira(offer)}`, step: { kind: 'savings', mode: 'deposit', amountMinor: offer } },
  };
}

function renewingSoon(input: NudgeInput): Nudge | null {
  const soon = (input.picture?.subscriptions.items ?? [])
    .filter((item) => item.nextDate >= input.today && daysBetween(input.today, item.nextDate) <= 3)
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate))[0];
  if (!soon) return null;
  return {
    id: `renew:${soon.key}:${soon.nextDate}`,
    kind: 'renewing-soon',
    text: `${soon.name} renews ${whenWords(soon.nextDate, input.today)}, about ${naira(soon.typicalMinor)}. Still using it?`,
    ask: null,
    action: { label: 'See subscriptions', step: { kind: 'open', screen: 'plan' } },
  };
}

function invoiceOverdue(input: NudgeInput): Nudge | null {
  const late = input.invoices
    .filter((invoice) => invoice.status === 'sent' && invoice.dueAt.slice(0, 10) < input.today)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  if (!late) return null;
  return {
    id: `invoice:${late.id}`,
    kind: 'invoice-overdue',
    text: `${late.clientName}'s invoice for ${naira(late.amountMinor)} was due ${whenWords(late.dueAt.slice(0, 10), input.today)}. A short reminder usually does it.`,
    ask: null,
    action: { label: 'See invoices', step: { kind: 'open', screen: 'business' } },
  };
}

function underUsual(input: NudgeInput): Nudge | null {
  if (!input.lines || input.savingsMinor === null || !fresh(input.lines, input.today)) return null;
  const week = weekAgainstUsual(input.lines, input.today, isSpending);
  if (!week || week.usualMinor <= 0) return null;
  const under = week.usualMinor - week.thisWeekMinor;
  const offer = roundDown(under);
  if (under < week.usualMinor * 0.1 || offer < 200_000) return null;
  return {
    id: `under:${week.monday}`,
    kind: 'under-usual',
    text: `You've spent ${naira(week.thisWeekMinor)} this week, about ${naira(offer)} under your usual by now.`,
    ask: `Put ${naira(offer)} aside while it's there?`,
    action: { label: `Save ${naira(offer)}`, step: { kind: 'savings', mode: 'deposit', amountMinor: offer } },
  };
}

function smallLeaks(input: NudgeInput): Nudge | null {
  if (!input.lines || !input.picture || !fresh(input.lines, input.today)) return null;
  const threshold = input.picture.leaks.thresholdMinor;
  const week = weekAgainstUsual(input.lines, input.today, (line) => isSpending(line) && line.amountMinor <= threshold && LEAK_KINDS.includes(line.kind));
  if (!week || week.usualMinor <= 0) return null;
  if (week.thisWeekMinor < week.usualMinor * 1.25 || week.thisWeekMinor - week.usualMinor < 200_000) return null;
  const top = new Map<string, { name: string; total: number }>();
  for (const line of week.thisWeek) {
    const key = payeeKey(line) || line.kind;
    const entry = top.get(key) ?? { name: line.merchant || line.description, total: 0 };
    entry.total += line.amountMinor;
    top.set(key, entry);
  }
  const most = [...top.values()].sort((a, b) => b.total - a.total)[0];
  return {
    id: `leaks:${week.monday}`,
    kind: 'small-leaks',
    text: `Small payments are at ${naira(week.thisWeekMinor)} this week, against about ${naira(week.usualMinor)} by now usually.${most?.name ? ` Most of it is ${most.name}.` : ''}`,
    ask: null,
    action: { label: 'See small payments', step: { kind: 'open', screen: 'plan' } },
  };
}

function runwayLow(input: NudgeInput): Nudge | null {
  const months = input.picture?.runwayMonths;
  if (months === null || months === undefined || months >= 2) return null;
  const next = input.picture?.income.nextExpected;
  return {
    id: `runway:${input.today.slice(0, 7)}`,
    kind: 'runway-low',
    text: `At your usual spending, what you have lasts ${monthsWords(months)}. Worth going a little easy${next ? ` until ${dayWords(next)}, when money usually comes in` : ''}.`,
    ask: null,
    action: { label: 'See your plan', step: { kind: 'open', screen: 'plan' } },
  };
}

/** How far along a goal is: what was added to savings since it was set, against a straight line to its day. */
export function goalProgress(goal: Goal, savingsMinor: number, today: string) {
  const savedMinor = Math.min(goal.amountMinor, Math.max(0, savingsMinor - (goal.savingsAtStartMinor ?? 0)));
  if (!goal.by) return { savedMinor, reached: savedMinor >= goal.amountMinor, onTrack: null, monthlyNeedMinor: null, monthsLeft: null };
  const start = goal.createdAt.slice(0, 10);
  const total = Math.max(1, daysBetween(start, goal.by));
  const gone = Math.min(total, Math.max(0, daysBetween(start, today)));
  const expected = Math.round((goal.amountMinor * gone) / total);
  const daysLeft = Math.max(0, daysBetween(today, goal.by));
  const monthsLeft = daysLeft / 30.44;
  const left = goal.amountMinor - savedMinor;
  return {
    savedMinor,
    reached: savedMinor >= goal.amountMinor,
    onTrack: savedMinor >= expected,
    monthlyNeedMinor: monthsLeft >= 1 ? Math.ceil(left / monthsLeft / 100) * 100 : left,
    monthsLeft,
  };
}

function goalNudge(input: NudgeInput): Nudge | null {
  if (input.savingsMinor === null) return null;
  const goal = input.memory.goals.filter((each) => each.by && each.by >= input.today).sort((a, b) => a.by!.localeCompare(b.by!))[0];
  if (!goal) return null;
  const progress = goalProgress(goal, input.savingsMinor, input.today);
  const month = input.today.slice(0, 7);
  if (progress.reached) {
    return { id: `goal:${goal.id}:reached`, kind: 'goal', text: `You've put aside all ${naira(goal.amountMinor)} for ${goal.name}. Well done.`, ask: null, action: null };
  }
  if (progress.onTrack) {
    return {
      id: `goal:${goal.id}:${month}`,
      kind: 'goal',
      text: `${goal.name} is on track: ${naira(progress.savedMinor)} of ${naira(goal.amountMinor)} so far.`,
      ask: null,
      action: { label: 'Add to savings', step: { kind: 'savings', mode: 'deposit' } },
    };
  }
  return {
    id: `goal:${goal.id}:${month}`,
    kind: 'goal',
    text: `${goal.name} is a little behind: ${naira(progress.savedMinor)} of ${naira(goal.amountMinor)}. About ${naira(progress.monthlyNeedMinor!)} a month gets you there by ${dayWords(goal.by!)}.`,
    ask: null,
    action: { label: 'Add to savings', step: { kind: 'savings', mode: 'deposit' } },
  };
}

function taxSetAside(input: NudgeInput): Nudge | null {
  const tax = input.picture?.tax;
  if (!tax || tax.monthlyTaxMinor <= 0) return null;
  // Said once a month, near when money comes in: the payday they told me, or the first week.
  const dayOfMonth = Number(input.today.slice(8, 10));
  const payday = input.memory.payday;
  const near = payday !== null ? dayOfMonth >= payday && dayOfMonth - payday <= 5 : dayOfMonth <= 7;
  if (!near) return null;
  return {
    id: `tax:${input.today.slice(0, 7)}`,
    kind: 'tax-set-aside',
    text: `On your income, about ${naira(tax.monthlyTaxMinor)} a month goes to tax under the 2026 rules. Setting it aside now saves a scramble later.`,
    ask: null,
    action: { label: 'See your tax', step: { kind: 'open', screen: 'plan' } },
  };
}

function idleMoney(input: NudgeInput): Nudge | null {
  const monthlyOut = input.picture?.out.monthlyMinor ?? 0;
  if (input.balanceMinor === null || input.savingsMinor === null || monthlyOut <= 0 || input.picture?.thin) return null;
  const idle = roundDown(input.balanceMinor - monthlyOut);
  if (idle < 2_000_000) return null;
  return {
    id: `idle:${input.today.slice(0, 7)}`,
    kind: 'idle-money',
    text: `About ${naira(idle)} is sitting beyond a month of your usual spending.`,
    ask: `Want me to move it to savings, where it's kept apart?`,
    action: { label: `Save ${naira(idle)}`, step: { kind: 'savings', mode: 'deposit', amountMinor: idle } },
  };
}

function remindersDue(input: NudgeInput): Nudge[] {
  return dueReminders(input.memory, input.today).map((reminder) => ({
    id: `reminder:${reminder.id}`,
    kind: 'reminder-due' as const,
    text:
      reminder.due === input.today
        ? `You asked me to remind you today: ${reminder.what}.`
        : `You asked me to remind you ${whenWords(reminder.due, input.today)}: ${reminder.what}.`,
    ask: null,
    action: null,
  }));
}

/** Everything worth saying today, the most useful first, at most three. */
export function buildNudges(input: NudgeInput): Nudge[] {
  const all = [
    ...remindersDue(input),
    incomeLanded(input),
    renewingSoon(input),
    invoiceOverdue(input),
    underUsual(input),
    smallLeaks(input),
    runwayLow(input),
    goalNudge(input),
    taxSetAside(input),
    idleMoney(input),
  ].filter((nudge): nudge is Nudge => nudge !== null && !input.memory.dismissed.has(nudge.id));
  return all.sort((a, b) => RANK[b.kind] - RANK[a.kind]).slice(0, MOST_NUDGES);
}

/** A nudge said aloud: the sentence and its offer. */
export function nudgeLine(nudge: Nudge): string {
  return nudge.ask ? `${nudge.text} ${nudge.ask}` : nudge.text;
}

/**
 * What Ayo says when it is opened. With a nudge, the nudge, after a hello by
 * name: "Morning, Evan. Brightloop paid ₦500,000. Want me to put ₦50,000
 * aside?" Without one, a plain hello that varies.
 */
export function openingLine(nudge: Nudge | null, displayName: string | null, now: Date, seed = 0): string {
  const name = firstNameOf(displayName);
  const hello = `${partOfDay(now)}${name ? `, ${name}` : ''}.`;
  if (nudge) return `${hello} ${nudgeLine(nudge)}`;
  return `${hello} ${pick(['What can I do for you?', 'What do you need?', 'How can I help?', 'What are we doing today?'], seed)}`;
}
