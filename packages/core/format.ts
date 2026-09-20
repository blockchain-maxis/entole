/** Date and duration strings, formatted only at the render boundary. */

// Times use en-US only because en-NG lower-cases the day period; the design
// sets it as "9:41 AM". Dates stay on en-NG for "2 Sept 2026" ordering.
const TIME = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const TIME_WITH_SECONDS = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

const DAY = new Intl.DateTimeFormat('en-NG', { weekday: 'short' });

const FULL = new Intl.DateTimeFormat('en-NG', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function timeOfDay(iso: string): string {
  return TIME.format(new Date(iso));
}

export function timeWithSeconds(iso: string): string {
  return TIME_WITH_SECONDS.format(new Date(iso));
}

/** "Settled 2 Sept 2026 at 9:41:07 AM" */
export function settledAt(iso: string): string {
  const date = new Date(iso);
  return `Settled ${FULL.format(date)} at ${TIME_WITH_SECONDS.format(date)}`;
}

/** "Today · 9:04 AM", "Yesterday", "Mon 4:12 PM", "1 Aug · 9:02 AM" */
export function relativeMoment(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const days = daysBetween(date, now);
  if (days === 0) return `Today · ${TIME.format(date)}`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${DAY.format(date)} ${TIME.format(date)}`;
  return `${date.getDate()} ${FULL.format(date).split(' ')[1]} · ${TIME.format(date)}`;
}

function daysBetween(a: Date, b: Date): number {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOf(b) - startOf(a)) / 86_400_000);
}

/** "Resets 1 Oct" */
export function resetLabel(iso: string): string {
  const date = new Date(iso);
  const month = FULL.format(date).split(' ')[1];
  return `Resets ${date.getDate()} ${month}`;
}

/** "Payout 1 Oct" — same shape as `resetLabel`, different word. */
export function payoutLabel(iso: string): string {
  const date = new Date(iso);
  const month = FULL.format(date).split(' ')[1];
  return `Payout ${date.getDate()} ${month}`;
}

/** Whole days between now and a future ISO date, floored at 0. */
export function daysUntil(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000));
}

export function secondsWords(seconds: number): string {
  return seconds === 1 ? '1 second' : `${seconds} seconds`;
}

/** "about 20 seconds" — deliberately vague, it is an estimate. */
export function arrivalEstimate(seconds: number): string {
  return `about ${seconds} seconds`;
}

/**
 * "Good morning" / "Good afternoon" / "Good evening", by the *device's* local
 * hour — the person's own clock, wherever they are.
 */
export function greetingFor(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
