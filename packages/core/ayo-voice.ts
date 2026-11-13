/**
 * How Ayo sounds when the app speaks for it: the small helpers every spoken
 * sentence on the device is built with.
 *
 * A person does not say the same sentence the same way twice, so a line has a
 * few ways of being said and one is picked by the turn number. The pick is
 * plain arithmetic on that number, never a random draw, so a test that passes
 * the same turn hears the same words.
 *
 * Nothing here holds a figure of its own. Every amount spoken is passed in
 * from the person's own books.
 */

/** Words the product never says to a person. A sentence carrying one is not said. */
export const NEVER_SAID =
  /\b(wallet|crypto\w*|blockchain|on-?chain|chain|gas|token|seed phrase|recovery phrase|private key|transaction hash|signature)\b/i;

/** Emoji and pictographs: Ayo speaks, it does not decorate. */
const PICTURES = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

/** One of a few ways of saying the same thing, chosen by the turn. */
export function pick<T>(options: readonly T[], seed = 0): T {
  if (!options.length) throw new Error('pick needs at least one option');
  const index = Math.abs(Math.trunc(seed)) % options.length;
  return options[index]!;
}

/** The first word of a display name, or null. "Evan Ezedike" is "Evan". */
export function firstNameOf(displayName: string | null | undefined): string | null {
  const first = displayName?.trim().split(/\s+/)[0];
  return first && /\p{L}/u.test(first) ? first : null;
}

/** "Morning", "Afternoon" or "Evening", in Lagos time, where the person is. */
export function partOfDay(now: Date): 'Morning' | 'Afternoon' | 'Evening' {
  const hour = (now.getUTCHours() + 1) % 24;
  if (hour >= 4 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 17) return 'Afternoon';
  return 'Evening';
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "25 November", for a day written YYYY-MM-DD. */
export function dayWords(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** Whole days from one YYYY-MM-DD to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** A day so many days after another, as YYYY-MM-DD. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Today in Lagos, as YYYY-MM-DD. */
export function lagosToday(now: Date): string {
  return new Date(now.getTime() + 3_600_000).toISOString().slice(0, 10);
}

/** "today", "tomorrow", "in 3 days", "on 25 November": when something falls, said the way a person would. */
export function whenWords(day: string, today: string): string {
  const days = daysBetween(today, day);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 1 && days <= 6) return `in ${days} days`;
  if (days < -1 && days >= -6) return `${-days} days ago`;
  return `on ${dayWords(day)}`;
}

/** Months, said: "about 4 months", "about a month", "under a month". */
export function monthsWords(months: number): string {
  if (months < 1) return 'under a month';
  const rounded = Math.round(months * 2) / 2;
  if (rounded === 1) return 'about a month';
  if (rounded === 1.5) return 'about a month and a half';
  return `about ${String(rounded).replace(/\.5$/, ' and a half')} months`;
}

/**
 * Text that came from a model, made fit to keep or to say: one line, no
 * pictures, no product-forbidden words, at most `max` characters. Null when
 * nothing fit is left.
 */
export function plainWords(text: string | null | undefined, max: number): string | null {
  const cleaned = (text ?? '')
    .replace(PICTURES, '')
    .replace(/[<>{}[\]|\\^`~*_#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || NEVER_SAID.test(cleaned)) return null;
  return cleaned.length > max ? cleaned.slice(0, max).replace(/\s+\S*$/, '').trim() || null : cleaned;
}
