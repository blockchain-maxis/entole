import type { AffordCheck, MoneyPicture } from '@entole/core/money-picture';
import { formatNaira, kobo } from '@entole/core/money';

/**
 * The sentences Plan and Home say about the money picture. Pure: every figure
 * comes from the picture, which comes from the person's own lines. Where a
 * figure is missing the sentence says why instead of inventing one.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const naira = (minor: number) => formatNaira(kobo(minor));

/** "25 Nov" from "2026-11-25". */
export function dayWords(day: string): string {
  const [, month, date] = day.split('-').map(Number) as [number, number, number];
  return `${date} ${MONTHS[month - 1] ?? ''}`.trim();
}

/** "1 Aug – 31 Oct". */
export function periodWords(from: string, to: string): string {
  return `${dayWords(from)} – ${dayWords(to)}`;
}

/** Why a figure is not there yet, in one line. */
export const THIN_WORDS = 'Read at least four weeks of statements to see this.';

/** "until 25 Nov, when Brightloop usually pays" or "until the month's end". */
export function safeUntilWords(picture: MoneyPicture): string {
  const safe = picture.safeToSpend;
  if (!safe) return '';
  const next = picture.income.nextExpected;
  if (safe.untilIncome && next) {
    const payer = picture.income.sources.find((source) => source.monthly)?.name;
    return payer ? `until ${dayWords(next)}, when ${payer} usually pays` : `until ${dayWords(next)}, when money usually comes in`;
  }
  return "until the month's end";
}

/** "2.4 months", "about a month", "under a month". */
export function runwayWords(months: number): string {
  if (months < 1) return 'under a month';
  if (months < 1.5) return 'about a month';
  return `about ${months.toFixed(1).replace(/\.0$/, '')} months`;
}

/** Basis points as a percentage a person reads: 1250 → "12.5%". */
export function percentWords(bps: number): string {
  return `${(bps / 100).toFixed(1).replace(/\.0$/, '')}%`;
}

/** The answer to "Can I afford it?", as a sentence or two. */
export function affordWords(check: AffordCheck): { headline: string; detail: string } {
  const amount = naira(check.amountMinor);
  const after = check.runwayAfter !== null ? `${runwayWords(check.runwayAfter)} of your usual spending` : null;
  const earnBack = check.daysToEarnBack !== null ? ` What you usually keep each month earns it back in about ${check.daysToEarnBack} days.` : '';
  const daily = check.safeTodayAfterMinor !== null ? ` Safe to spend would be ${naira(check.safeTodayAfterMinor)} a day.` : '';

  if (check.verdict === 'not-now') {
    return {
      headline: 'Not now',
      detail: `${amount} would leave you ${naira(check.shortByMinor)} short of what is already due before your next income.${earnBack}`,
    };
  }
  if (check.verdict === 'tight') {
    return {
      headline: 'You can, but it is tight',
      detail: `Your bills before payday stay covered${after ? `, and ${after} would be left` : ''}.${daily}${earnBack}`,
    };
  }
  return {
    headline: 'Yes, comfortably',
    detail: `Your bills before payday stay covered${after ? `, and ${after} would be left` : ''}.${daily}${earnBack}`,
  };
}

export type SuggestionRow = { title: string; caption: string; action: 'savings' | 'subscriptions' | 'leaks'; amountMinor?: number };

/** One row per suggestion, each with what tapping it does. */
export function suggestionRow(suggestion: MoneyPicture['suggestions'][number]): SuggestionRow {
  switch (suggestion.kind) {
    case 'save-underspend':
      return {
        title: `Put ${naira(suggestion.amountMinor)} into savings`,
        caption: `You spent ${naira(suggestion.underMinor)} less than usual this month.`,
        action: 'savings',
        amountMinor: suggestion.amountMinor,
      };
    case 'review-subscriptions':
      return {
        title: `Look over ${suggestion.count} ${suggestion.count === 1 ? 'subscription' : 'subscriptions'}`,
        caption: `${naira(suggestion.monthlyMinor)} a month between them.`,
        action: 'subscriptions',
      };
    case 'small-leaks':
      return {
        title: 'Watch the small payments',
        caption: `${suggestion.count} of them came to ${naira(suggestion.totalMinor)} in the last month.`,
        action: 'leaks',
      };
    case 'thin-buffer':
      return {
        title: 'Build a cushion',
        caption: `Your money lasts ${runwayWords(suggestion.runwayMonths)} with nothing coming in. Three months is safer.`,
        action: 'savings',
      };
    case 'set-aside-tax':
      return {
        title: `Set aside ${naira(suggestion.monthlyMinor)} a month for tax`,
        caption: 'Kept in savings, it is there when the bill comes.',
        action: 'savings',
        amountMinor: suggestion.monthlyMinor,
      };
  }
}
