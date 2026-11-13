import type { AffordCheck, MoneyPicture, SafeToSpend, Suggestion } from '@entole/core/money-picture';
import { formatNaira, kobo } from '@entole/core/money';
import type { StatementRead } from '@entole/core/records';

/**
 * The words the Plan tab and Home put round the money picture. Every figure in
 * them is the person's own, from `MoneyPicture`; where one is null the words
 * say why instead of filling it in.
 */

const naira = (minor: number) => formatNaira(kobo(Math.max(0, Math.round(minor))));

/** "25 Nov", from a statement date (`2026-11-25`). Read as a calendar day, not a moment. */
export function dayWords(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** "1 Aug – 31 Oct · bank figure from 31 Oct". */
export function periodWords(picture: Pick<MoneyPicture, 'from' | 'to'>, latest: StatementRead | null): string {
  const span = `${dayWords(picture.from)} – ${dayWords(picture.to)}`;
  return latest?.closingMinor !== undefined ? `${span} · bank figure from ${dayWords(latest.to)}` : span;
}

/** Basis points as a person reads a share: 1234 → "12.3%". */
export function percentWords(bps: number): string {
  return `${Math.round(bps / 10) / 10}%`;
}

/** 2.4 → "about 2.4 months"; under one, said as under a month. */
export function monthsWords(months: number): string {
  if (months < 1) return 'under a month';
  const rounded = Math.round(months * 10) / 10;
  return `about ${rounded} ${rounded === 1 ? 'month' : 'months'}`;
}

/**
 * Under the safe-to-spend figure: how long it is meant to last, and why then.
 * "until 25 Nov, when Brightloop usually pays", or "until the month's end".
 */
export function safeToSpendNote(picture: MoneyPicture, safe: SafeToSpend): string {
  const each = safe.days === 1 ? 'for today' : `each day for ${safe.days} days`;
  if (safe.untilIncome && picture.income.nextExpected) {
    const payer = [...picture.income.sources].filter((source) => source.monthly).sort((a, b) => b.totalMinor - a.totalMinor)[0];
    const when = dayWords(picture.income.nextExpected);
    return payer ? `${each}, until ${when}, when ${payer.name} usually pays` : `${each}, until ${when}, when money usually comes in`;
  }
  return `${each}, until the month's end`;
}

/** Why a figure is not there, in the person's terms. */
export const THIN_WORDS = 'Read at least four weeks of statements to see this.';

/** The answer to "can I afford it?", as one or two sentences. */
export function affordWords(check: AffordCheck): { headline: string; detail: string } {
  const amount = naira(check.amountMinor);
  const runway = check.runwayAfter === null ? null : monthsWords(check.runwayAfter);
  const earnBack =
    check.daysToEarnBack === null
      ? null
      : `What you usually have left over each month earns it back in about ${check.daysToEarnBack} ${check.daysToEarnBack === 1 ? 'day' : 'days'}.`;
  const perDay =
    check.safeTodayAfterMinor === null ? null : `After it, ${naira(check.safeTodayAfterMinor)} a day is safe to spend.`;

  if (check.verdict === 'not-now') {
    return {
      headline: 'Not now',
      detail: [`${amount} would eat ${naira(check.shortByMinor)} into what is kept back for bills, savings and tax before you are next paid.`, earnBack]
        .filter(Boolean)
        .join(' '),
    };
  }
  if (check.verdict === 'tight') {
    return {
      headline: 'You can, but it is tight',
      detail: [runway ? `It leaves ${runway} of your usual spending.` : null, perDay, earnBack].filter(Boolean).join(' '),
    };
  }
  return {
    headline: 'Yes, comfortably',
    detail: [
      `What is due before you are next paid is still covered${runway ? `, and ${runway} of your usual spending is left` : ''}.`,
      perDay,
      earnBack,
    ]
      .filter(Boolean)
      .join(' '),
  };
}

/** A suggestion as a row: what to do, the figure behind it, and where it goes. */
export function suggestionRow(suggestion: Suggestion): { title: string; detail: string; href: string } {
  switch (suggestion.kind) {
    case 'save-underspend':
      return {
        title: `Put ${naira(suggestion.amountMinor)} in savings`,
        detail: `You spent ${naira(suggestion.underMinor)} less than usual this month.`,
        href: `/grow/savings?mode=deposit&amount=${Math.round(suggestion.amountMinor)}`,
      };
    case 'review-subscriptions':
      return {
        title: `Look over ${suggestion.count} ${suggestion.count === 1 ? 'subscription' : 'subscriptions'}`,
        detail: `${naira(suggestion.monthlyMinor)} a month, every month.`,
        href: '#subscriptions',
      };
    case 'small-leaks':
      return {
        title: 'Watch the small payments',
        detail: `${suggestion.count} of them came to ${naira(suggestion.totalMinor)}.`,
        href: '#leaks',
      };
    case 'thin-buffer':
      return {
        title: 'Build a cushion',
        detail: `Your money lasts ${monthsWords(suggestion.runwayMonths)} if nothing came in. Three months is a steady place to be.`,
        href: '/grow/savings?mode=deposit',
      };
    case 'set-aside-tax':
      return {
        title: `Set aside ${naira(suggestion.monthlyMinor)} a month for tax`,
        detail: 'So the bill is never a surprise.',
        href: '#tax',
      };
  }
}

/** What the bank's own figures say about the reading. */
export function balanceCheckWords(read: Pick<StatementRead, 'status' | 'differenceMinor'>): { ok: boolean; words: string } {
  if (read.status === 'balanced') return { ok: true, words: 'Balanced to the kobo' };
  if (read.status === 'off') {
    return {
      ok: false,
      words: `Off by ${naira(Math.abs(read.differenceMinor ?? 0))}. A line may be missing, so some figures may be off.`,
    };
  }
  return { ok: false, words: 'No opening or closing figure to check against' };
}
