import type { Nudge } from './ayo-nudges';
import { addDays, daysBetween } from './ayo-voice';
import { NOT_SPENDING } from './money-picture';
import { formatNaira, kobo } from './money';
import { SPENDING_KIND_WORDS, type SpendingKind, type StatementLine } from './statement';

/**
 * The monthly check-in: what came in, what went out, what changed against the
 * month before, and one thing to do next. Said in a few short sentences.
 *
 * "A month" is the last thirty days of lines and the thirty before them, so
 * it works on whatever day it is asked. Every figure is a sum of the person's
 * own lines. With under thirty days there is no check-in to give, and with
 * under sixty there is no "what changed", and it says so rather than guess.
 */

const WINDOW = 30;

export type Checkin = {
  from: string;
  to: string;
  inMinor: number;
  outMinor: number;
  /** The month before, when there is a whole one. */
  before: { inMinor: number; outMinor: number } | null;
  /** The kind of spending that moved most against the month before. */
  biggestChange: { kind: SpendingKind; nowMinor: number; beforeMinor: number } | null;
};

const naira = (minor: number) => formatNaira(kobo(minor));

export function buildCheckin(lines: readonly StatementLine[], today: string): Checkin | null {
  if (!lines.length) return null;
  const last = lines.reduce((latest, line) => (line.date > latest ? line.date : latest), lines[0]!.date);
  const first = lines.reduce((earliest, line) => (line.date < earliest ? line.date : earliest), lines[0]!.date);
  const to = last < today ? last : today;
  const from = addDays(to, -(WINDOW - 1));
  if (daysBetween(first, to) + 1 < WINDOW) return null;
  const beforeFrom = addDays(from, -WINDOW);
  const hasBefore = first <= beforeFrom;

  const within = (start: string, end: string) => lines.filter((line) => line.date >= start && line.date <= end);
  const sums = (list: readonly StatementLine[]) => ({
    inMinor: list.filter((line) => line.direction === 'in' && (line.kind === 'income' || line.kind === 'transfer-in')).reduce((sum, line) => sum + line.amountMinor, 0),
    outMinor: list.filter((line) => line.direction === 'out' && !NOT_SPENDING.includes(line.kind)).reduce((sum, line) => sum + line.amountMinor, 0),
  });
  const now = within(from, to);
  const earlier = hasBefore ? within(beforeFrom, addDays(from, -1)) : [];

  let biggestChange: Checkin['biggestChange'] = null;
  if (hasBefore) {
    const byKind = (list: readonly StatementLine[]) => {
      const totals = new Map<SpendingKind, number>();
      for (const line of list) if (line.direction === 'out' && !NOT_SPENDING.includes(line.kind)) totals.set(line.kind, (totals.get(line.kind) ?? 0) + line.amountMinor);
      return totals;
    };
    const a = byKind(now);
    const b = byKind(earlier);
    for (const kind of new Set([...a.keys(), ...b.keys()])) {
      const change = { kind, nowMinor: a.get(kind) ?? 0, beforeMinor: b.get(kind) ?? 0 };
      const size = Math.abs(change.nowMinor - change.beforeMinor);
      if (size >= 500_000 && (!biggestChange || size > Math.abs(biggestChange.nowMinor - biggestChange.beforeMinor))) biggestChange = change;
    }
  }
  return { from, to, ...sums(now), before: hasBefore ? sums(earlier) : null, biggestChange };
}

/** The check-in, spoken. `next` is the one thing to do, from the nudges. */
export function checkinWords(checkin: Checkin | null, next: Nudge | null): string {
  if (!checkin) return 'I need about a month of your money to do a check-in. Read a bank statement in Plan and I can start.';
  const parts = [`Over the last month, ${naira(checkin.inMinor)} came in and ${naira(checkin.outMinor)} went out.`];
  if (checkin.before) {
    const diff = checkin.outMinor - checkin.before.outMinor;
    if (Math.abs(diff) < checkin.before.outMinor * 0.05) parts.push('Spending was about the same as the month before.');
    else parts.push(diff > 0 ? `That's ${naira(diff)} more spent than the month before.` : `That's ${naira(-diff)} less spent than the month before. Nice.`);
    const change = checkin.biggestChange;
    if (change) {
      const words = SPENDING_KIND_WORDS[change.kind].toLowerCase();
      parts.push(change.nowMinor > change.beforeMinor
        ? `Most of the change is ${words}, up from ${naira(change.beforeMinor)} to ${naira(change.nowMinor)}.`
        : `${SPENDING_KIND_WORDS[change.kind]} came down, from ${naira(change.beforeMinor)} to ${naira(change.nowMinor)}.`);
    }
  } else {
    parts.push('Next month I can tell you what changed.');
  }
  if (next) parts.push(`One more thing. ${next.text}${next.ask ? ` ${next.ask}` : ''}`);
  return parts.join(' ');
}
