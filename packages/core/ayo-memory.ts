import { z } from 'zod';

import { addDays, daysBetween, plainWords } from './ayo-voice';

/**
 * What Ayo remembers about the person, so what it says is about them and does
 * not repeat: the goals they are saving towards, a few preferences, the
 * nudges they said no to, and the reminders they asked for.
 *
 * Kept like every other record (`records.ts`): on the device, and sealed
 * under the person's own passkey when it follows them to another device
 * (`record-sync.ts`). The talking model never sees it. It hands back "a goal
 * called laptop, 400,000, by March"; the device keeps that, and only the
 * device reads it back.
 *
 * Pure: the clock is passed in, nothing is fetched.
 */

/** The only preferences there are. A model naming another is not listened to. */
export const PREFERENCE_KEYS = ['payday', 'savings-share', 'reply-style'] as const;
export type PreferenceKey = (typeof PREFERENCE_KEYS)[number];

export const REPLY_STYLES = ['english', 'pidgin', 'short'] as const;
export type ReplyStyle = (typeof REPLY_STYLES)[number];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const at = z.string().min(10).max(40);

export const memoryEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('goal'),
    id: z.string().min(1).max(40),
    name: z.string().min(1).max(40),
    amountMinor: z.number().int().positive().max(100_000_000_000),
    by: day.optional(),
    createdAt: at,
    /** What was in savings when the goal was set, so progress is what was added since. */
    savingsAtStartMinor: z.number().int().nonnegative().optional(),
  }),
  z.object({ kind: z.literal('pref'), key: z.enum(PREFERENCE_KEYS), value: z.string().min(1).max(20), at }),
  z.object({ kind: z.literal('dismissed'), id: z.string().min(1).max(120), at }),
  z.object({
    kind: z.literal('reminder'),
    id: z.string().min(1).max(40),
    what: z.string().min(1).max(80),
    due: day,
    createdAt: at,
    done: z.boolean().optional(),
  }),
]);

export type MemoryEntry = z.infer<typeof memoryEntrySchema>;
export type Goal = Extract<MemoryEntry, { kind: 'goal' }>;
export type Reminder = Extract<MemoryEntry, { kind: 'reminder' }>;

/** Enough for a life's worth of goals and reminders, and far under a record's size limit. */
export const MEMORY_MAX_ENTRIES = 200;
const MOST_GOALS = 12;
const MOST_REMINDERS = 40;
const MOST_DISMISSED = 100;

export type AyoMemory = {
  goals: Goal[];
  reminders: Reminder[];
  dismissed: ReadonlySet<string>;
  /** Day of the month pay usually lands, 1 to 31. */
  payday: number | null;
  /** Share of income offered to savings when it lands, in basis points. */
  savingsShareBps: number | null;
  replyStyle: ReplyStyle | null;
};

export const EMPTY_MEMORY: AyoMemory = {
  goals: [],
  reminders: [],
  dismissed: new Set(),
  payday: null,
  savingsShareBps: null,
  replyStyle: null,
};

/** Reads a stored list, dropping anything that does not parse. */
export function parseMemory(raw: unknown): MemoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const parsed = memoryEntrySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/** The list, as what it means. The newest preference of each key wins. */
export function readMemory(entries: readonly MemoryEntry[]): AyoMemory {
  const prefs = new Map<PreferenceKey, string>();
  for (const entry of entries) if (entry.kind === 'pref') prefs.set(entry.key, entry.value);
  const payday = prefs.has('payday') ? parsePreference('payday', prefs.get('payday')!) : null;
  const share = prefs.has('savings-share') ? parsePreference('savings-share', prefs.get('savings-share')!) : null;
  const style = prefs.has('reply-style') ? parsePreference('reply-style', prefs.get('reply-style')!) : null;
  return {
    goals: entries.filter((entry): entry is Goal => entry.kind === 'goal'),
    reminders: entries.filter((entry): entry is Reminder => entry.kind === 'reminder'),
    dismissed: new Set(entries.flatMap((entry) => (entry.kind === 'dismissed' ? [entry.id] : []))),
    payday: typeof payday === 'number' ? payday : null,
    savingsShareBps: typeof share === 'number' ? share : null,
    replyStyle: typeof style === 'string' ? (style as ReplyStyle) : null,
  };
}

/**
 * A preference as it was said, in the form it is kept, or null when it is not
 * one that can be kept. Payday is a day of the month; the savings share is a
 * percentage from 1 to 50, kept in basis points; the reply style is one of
 * three.
 */
export function parsePreference(key: PreferenceKey, value: string): number | ReplyStyle | null {
  const said = value.trim().toLowerCase();
  if (key === 'payday') {
    const match = /^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?$/.exec(said);
    const dayOfMonth = match ? Number(match[1]) : NaN;
    return dayOfMonth >= 1 && dayOfMonth <= 31 ? dayOfMonth : null;
  }
  if (key === 'savings-share') {
    const match = /^(\d{1,2}(?:\.\d)?)\s*(?:%|percent|per cent)?$/.exec(said);
    const percent = match ? Number(match[1]) : NaN;
    return percent >= 1 && percent <= 50 ? Math.round(percent * 100) : null;
  }
  if (said === 'pidgin' || said === 'naija' || said === 'pidgin english') return 'pidgin';
  if (said === 'english' || said === 'plain english' || said === 'plain') return 'english';
  if (said === 'short' || said === 'brief' || said === 'shorter') return 'short';
  return null;
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * When a reminder or a goal falls, as a day, from what was said: a date
 * written YYYY-MM-DD, "today", "tomorrow", "next tomorrow", a weekday (the
 * next one after today), "next week", "in 3 days", "in 2 weeks", "end of the
 * month", a month ("March", "end of March", "March 2027": its last day, the
 * next one to come) or a day of the month ("the 25th", the next one to come). Null for
 * anything else, and for a day already gone or more than two years off.
 */
export function resolveWhen(when: string, today: string): string | null {
  const said = when.trim().toLowerCase().replace(/^(?:on|by|for)\s+/, '').replace(/[.,!?]+$/, '');
  let found: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(said)) {
    const date = new Date(`${said}T00:00:00Z`);
    found = Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== said ? null : said;
  } else if (said === 'today' || said === 'tonight' || said === 'this evening') found = today;
  else if (said === 'tomorrow' || said === 'tmrw' || said === 'tomorrow morning') found = addDays(today, 1);
  else if (said === 'next tomorrow' || said === 'day after tomorrow' || said === 'the day after tomorrow') found = addDays(today, 2);
  else if (said === 'next week') found = addDays(today, 7);
  else if (said === 'end of the month' || said === 'end of month' || said === 'month end') {
    const date = new Date(`${today}T00:00:00Z`);
    found = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  } else {
    const weekday = WEEKDAYS.indexOf(said.replace(/^(?:this|next)\s+/, ''));
    const inSome = /^in\s+(\d{1,3}|a|one|two|three)\s+(day|days|week|weeks)$/.exec(said);
    const dayOfMonth = /^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)(?:\s+of\s+the\s+month)?$/.exec(said);
    const month = /^(?:the\s+)?(?:end\s+of\s+)?([a-z]+)(?:\s+(\d{4}))?$/.exec(said);
    const monthIndex = month ? MONTH_NAMES.indexOf(month[1]!) : -1;
    if (monthIndex >= 0) {
      const now = new Date(`${today}T00:00:00Z`);
      const year = month![2] ? Number(month![2]) : now.getUTCFullYear() + (monthIndex < now.getUTCMonth() ? 1 : 0);
      found = new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);
    } else if (weekday >= 0) {
      const now = new Date(`${today}T00:00:00Z`).getUTCDay();
      found = addDays(today, ((weekday - now + 7) % 7) || 7);
    } else if (inSome) {
      const count = { a: 1, one: 1, two: 2, three: 3 }[inSome[1] as 'a'] ?? Number(inSome[1]);
      found = addDays(today, inSome[2]!.startsWith('week') ? count * 7 : count);
    } else if (dayOfMonth) {
      const wanted = Number(dayOfMonth[1]);
      if (wanted >= 1 && wanted <= 31) {
        const date = new Date(`${today}T00:00:00Z`);
        for (let ahead = 0; ahead < 3 && !found; ahead += 1) {
          const candidate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + ahead, wanted));
          const text = candidate.toISOString().slice(0, 10);
          if (candidate.getUTCDate() === wanted && text >= today) found = text;
        }
      }
    }
  }
  if (!found) return null;
  const ahead = daysBetween(today, found);
  return ahead >= 0 && ahead <= 730 ? found : null;
}

/** What Ayo was asked to change in what it remembers. */
export type MemoryChange =
  | { kind: 'goal'; name: string; amountMinor: number; by?: string | undefined }
  | { kind: 'prefer'; key: PreferenceKey; value: string }
  | { kind: 'remind'; what: string; when: string }
  | { kind: 'forget'; what: string }
  | { kind: 'dismiss'; id: string };

export type MemoryOutcome =
  | { ok: true; entries: MemoryEntry[]; kept: 'goal'; goal: Goal }
  | { ok: true; entries: MemoryEntry[]; kept: 'pref'; key: PreferenceKey; value: number | ReplyStyle }
  | { ok: true; entries: MemoryEntry[]; kept: 'reminder'; reminder: Reminder }
  | { ok: true; entries: MemoryEntry[]; kept: 'forgot'; names: string[] }
  | { ok: true; entries: MemoryEntry[]; kept: 'dismissed' }
  | { ok: false; why: 'bad-words' | 'bad-when' | 'bad-value' | 'too-many' | 'nothing-matches' | 'several'; names?: string[] };

const idFor = (prefix: string, now: Date, entries: readonly MemoryEntry[]) =>
  `${prefix}-${now.getTime().toString(36)}-${entries.length.toString(36)}`;

/** Lower-case words of three letters or more, for matching "the laptop one" to a goal called "New laptop". */
function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3 && !['the', 'and', 'for', 'one', 'goal', 'reminder', 'about', 'my'].includes(word));
}

/** Keeps the list inside its limits: the oldest dismissals go first, then the oldest of anything. */
function bounded(entries: MemoryEntry[]): MemoryEntry[] {
  let next = entries;
  const dismissed = next.filter((entry) => entry.kind === 'dismissed');
  if (dismissed.length > MOST_DISMISSED) {
    const drop = new Set<MemoryEntry>(dismissed.slice(0, dismissed.length - MOST_DISMISSED));
    next = next.filter((entry) => !drop.has(entry));
  }
  return next.slice(-MEMORY_MAX_ENTRIES);
}

/**
 * Applies one change. Words that came from the model are checked first: too
 * long, a forbidden word or nothing left, and nothing is kept. A goal's
 * amount is the one the person said, read like any amount; nothing is made up.
 */
export function changeMemory(
  entries: readonly MemoryEntry[],
  change: MemoryChange,
  context: { now: Date; today: string; savingsMinor: number | null },
): MemoryOutcome {
  const at = context.now.toISOString();
  if (change.kind === 'goal') {
    const name = plainWords(change.name, 40);
    if (!name) return { ok: false, why: 'bad-words' };
    const by = change.by ? resolveWhen(change.by, context.today) : undefined;
    if (change.by && !by) return { ok: false, why: 'bad-when' };
    const goals = entries.filter((entry) => entry.kind === 'goal');
    const same = goals.find((goal) => goal.name.toLowerCase() === name.toLowerCase());
    if (!same && goals.length >= MOST_GOALS) return { ok: false, why: 'too-many' };
    const goal: Goal = {
      kind: 'goal',
      id: same?.id ?? idFor('goal', context.now, entries),
      name,
      amountMinor: change.amountMinor,
      ...(by ? { by } : {}),
      createdAt: same?.createdAt ?? at,
      ...(same?.savingsAtStartMinor !== undefined
        ? { savingsAtStartMinor: same.savingsAtStartMinor }
        : context.savingsMinor !== null
          ? { savingsAtStartMinor: Math.max(0, context.savingsMinor) }
          : {}),
    };
    const rest = entries.filter((entry) => entry !== same);
    return { ok: true, entries: bounded([...rest, goal]), kept: 'goal', goal };
  }
  if (change.kind === 'prefer') {
    const value = parsePreference(change.key, change.value);
    if (value === null) return { ok: false, why: 'bad-value' };
    // Kept as it would be said again: a share as its percentage, a day as its number.
    const kept = change.key === 'savings-share' ? String((value as number) / 100) : String(value);
    const rest = entries.filter((entry) => !(entry.kind === 'pref' && entry.key === change.key));
    return { ok: true, entries: bounded([...rest, { kind: 'pref', key: change.key, value: kept, at }]), kept: 'pref', key: change.key, value };
  }
  if (change.kind === 'remind') {
    const what = plainWords(change.what, 80);
    if (!what) return { ok: false, why: 'bad-words' };
    const due = resolveWhen(change.when, context.today);
    if (!due) return { ok: false, why: 'bad-when' };
    const open = entries.filter((entry) => entry.kind === 'reminder' && !entry.done);
    if (open.length >= MOST_REMINDERS) return { ok: false, why: 'too-many' };
    const reminder: Reminder = { kind: 'reminder', id: idFor('remind', context.now, entries), what, due, createdAt: at };
    return { ok: true, entries: bounded([...entries, reminder]), kept: 'reminder', reminder };
  }
  if (change.kind === 'dismiss') {
    if (entries.some((entry) => entry.kind === 'dismissed' && entry.id === change.id)) {
      return { ok: true, entries: [...entries], kept: 'dismissed' };
    }
    // A reminder put away is done, not merely hidden.
    const marked = entries.map((entry) =>
      entry.kind === 'reminder' && change.id === `reminder:${entry.id}` ? { ...entry, done: true } : entry,
    );
    return { ok: true, entries: bounded([...marked, { kind: 'dismissed', id: change.id, at }]), kept: 'dismissed' };
  }
  // Forgetting: a goal or a reminder whose words match what was said, or a preference by its name.
  const asked = change.what.toLowerCase();
  const prefKey = PREFERENCE_KEYS.find((key) => asked.includes(key.replace('-', ' ')) || (key === 'payday' && /\bpay ?day\b/.test(asked)) || (key === 'reply-style' && /\b(?:pidgin|style)\b/.test(asked)));
  if (prefKey) {
    const rest = entries.filter((entry) => !(entry.kind === 'pref' && entry.key === prefKey));
    if (rest.length !== entries.length) return { ok: true, entries: rest, kept: 'forgot', names: [prefKey.replace('-', ' ')] };
  }
  const sought = words(change.what);
  const named = entries.filter(
    (entry): entry is Goal | Reminder =>
      (entry.kind === 'goal' || (entry.kind === 'reminder' && !entry.done)) &&
      sought.some((word) => words(entry.kind === 'goal' ? entry.name : entry.what).includes(word)),
  );
  if (!named.length) return { ok: false, why: 'nothing-matches' };
  if (named.length > 1) {
    return { ok: false, why: 'several', names: named.slice(0, 3).map((entry) => (entry.kind === 'goal' ? entry.name : entry.what)) };
  }
  const gone = named[0]!;
  return {
    ok: true,
    entries: entries.filter((entry) => entry !== gone),
    kept: 'forgot',
    names: [gone.kind === 'goal' ? gone.name : gone.what],
  };
}

/** Reminders that are due by today and not yet done, oldest first. */
export function dueReminders(memory: AyoMemory, today: string): Reminder[] {
  return memory.reminders.filter((reminder) => !reminder.done && reminder.due <= today).sort((a, b) => a.due.localeCompare(b.due));
}
