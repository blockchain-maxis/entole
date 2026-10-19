/**
 * Who the assistant is: its name, how it is woken, how it sounds, and the few
 * things it always says the same way.
 *
 * Nothing here touches money or the account. It is the part of the assistant a
 * person meets, kept apart from `assistant-actions.ts` (what it may do) so a
 * name or an accent can change without the vocabulary moving.
 */

/**
 * The assistant's name. Short, two syllables, and easy for a speech recogniser
 * to hear: it is Yoruba for joy, and a name many Nigerians already answer to.
 * Everything that says or listens for the name reads it from here.
 */
export const ASSISTANT_NAME = 'Ayo';

// ---------------------------------------------------------------------------
// Being woken.
// ---------------------------------------------------------------------------

/**
 * How speech recognition tends to write the name. It is not told what "Ayo" is,
 * so it hears "iyo", "ayoh", "a yo" and the like; all of them wake the assistant.
 * A wrong wake costs a few seconds of listening and nothing else, so the net is
 * cast wide on the spelling and narrow on the greeting.
 */
const NAME_HEARD = String.raw`(?:a+[yi]+o+h?|[ie]+y+o+|a\s+yo|ay\s+yo)`;
const GREETING = String.raw`(?:hey|hay|hi|hello|okay|ok|yo|oh)`;

/** "hey ayo" anywhere in what was heard, or just "ayo" when it opens the sentence. */
const WAKE = new RegExp(String.raw`(?:\b${GREETING}[\s,.!]+${NAME_HEARD}\b|^\s*${NAME_HEARD}\b)[\s,.!?]*`, 'i');

export type Wake = { woke: false } | { woke: true; rest: string };

// ---------------------------------------------------------------------------
// The name, as a recogniser tends to get it wrong.
// ---------------------------------------------------------------------------

const GREETING_WORDS = new Set([
  'hey', 'hay', 'hi', 'hello', 'hiya', 'okay', 'ok', 'yo', 'oh', 'heyy', 'hei',
  // What "hey" turns into when the name after it is a surprise to the recogniser.
  'here', 'hear', 'high', 'heya', 'hearing',
]);

/** Written the way it sounds, with no spaces: "a yo" and "iyo" and "i o" all end up here. */
const NAME_SOUNDS = new Set([
  'ayo', 'ayoh', 'ayyo', 'aiyo', 'iyo', 'eyo', 'ayu', 'aio', 'io', 'ioh', 'ayoo', 'aayo', 'ahyo', 'ahyou', 'ayou',
  'eyoh', 'ayeo', 'ayew', 'aya', 'ayio', 'ioo', 'eio', 'yo',
]);

/** Sounds that pass for the name only straight after a greeting: on their own, "oh" is just a word. */
const ONLY_AFTER_GREETING = new Set([
  'oh', 'o', 'ah', 'aw', 'ay', 'eh',
  // "Hey Ayo" written as "hey are you", the commonest way a recogniser hears it.
  'areyou', 'aryou', 'areu', 'areyo', 'arryou', 'ayare', 'ayou',
]);

/**
 * "Ayo" is said "EYE-yo", so a recogniser writes what it hears: "I yo", "I your",
 * "eye you", "ai yo". Straight after a greeting, a vowel sound followed by a "yo"
 * sound is taken as the name. On its own, at the start of a sentence, it is not:
 * "I you" is too likely to be something else.
 */
const EYE_YO = /^(?:a|i|e|ai|ay|ey|eye|ah|eh)(?:y?o+h?|you|your|yor|yore|yoo|yaw)$/;

/** A greeting and the name run together: "heyo", "hayo", "hiyo". */
const FUSED = /^(?:h[ae]i?y?o|hiy?o|h[ae]i?yayo|heyayo|hiayo|hayayo)$/;

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, at) => at);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j]!;
      row[j] = Math.min(above + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}

/** Whether a word, or two run together, sounds enough like the name. */
function soundsLikeName(candidate: string): boolean {
  if (!candidate) return false;
  return NAME_SOUNDS.has(candidate) || (candidate.length >= 2 && candidate.length <= 6 && distance(candidate, 'ayo') <= 1);
}

/**
 * The fallback for what the pattern above misses: a recogniser that was never
 * told the name writes "hey iyo", "hey a you", "heyo", "hey I O", "hi ayu". It
 * looks at the words after a greeting (one, or two run together) and at the
 * first word of the sentence, and wakes if they sound like the name.
 */
function fuzzyWake(heard: string): Wake {
  const raw = heard.split(/\s+/).filter(Boolean);
  const clean = raw.map((word) => word.toLowerCase().replace(/[^a-z']/g, ''));
  const restFrom = (at: number) => ({ woke: true as const, rest: raw.slice(at).join(' ').replace(/^[\s,.!?]+/, '').trim() });

  for (let at = 0; at < clean.length; at += 1) {
    const word = clean[at]!;
    if (FUSED.test(word)) return restFrom(at + 1);
    if (!GREETING_WORDS.has(word)) continue;
    for (const span of [1, 2]) {
      const next = clean.slice(at + 1, at + 1 + span).join('');
      if (soundsLikeName(next) || EYE_YO.test(next) || ONLY_AFTER_GREETING.has(next)) return restFrom(at + 1 + span);
    }
  }
  for (const span of [1, 2]) {
    if (soundsLikeName(clean.slice(0, span).join(''))) return restFrom(span);
  }
  return { woke: false };
}

/**
 * Whether the assistant was called, and what was said after its name in the
 * same breath. "Hey Ayo, what's my balance" wakes it with "what's my balance";
 * "hey Ayo" alone wakes it with nothing, and it asks what is needed.
 */
export function readWake(heard: string): Wake {
  const match = WAKE.exec(heard);
  if (match) {
    const rest = heard
      .slice(match.index + match[0].length)
      .replace(/\s+/g, ' ')
      .trim();
    return { woke: true, rest };
  }
  return fuzzyWake(heard);
}

/** The name and the wake-up greeting taken off the front of a sentence, for the readers that don't need them. */
export function withoutName(heard: string): string {
  const woke = readWake(heard);
  return woke.woke ? woke.rest : heard.trim();
}

// ---------------------------------------------------------------------------
// Accents.
// ---------------------------------------------------------------------------

/**
 * The ways the assistant can sound and listen. Nigerian English is the first;
 * more are added here as they are made, and the rest of the app (the settings
 * row, the speech and the listening) reads this list rather than a language
 * code of its own.
 */
export type Accent = {
  id: string;
  /** What the person is shown. */
  label: string;
  /** The language the phone or browser is asked to listen for. */
  listen: string;
  /** The language its voice is asked to speak in. */
  speak: string;
};

export const ACCENTS: readonly Accent[] = [
  { id: 'ng', label: 'Nigerian English', listen: 'en-NG', speak: 'en-NG' },
];

export const DEFAULT_ACCENT_ID = 'ng';

/** The accent saved under this id, or the default when it is unknown (a list that has since changed). */
export function accentFor(id: string | null | undefined): Accent {
  return ACCENTS.find((accent) => accent.id === id) ?? ACCENTS.find((accent) => accent.id === DEFAULT_ACCENT_ID)!;
}

// ---------------------------------------------------------------------------
// What it always says the same way.
// ---------------------------------------------------------------------------

/** Said when it is woken with nothing else, to say it is listening. Rotated so it is not a recording. */
export const WAKE_REPLIES = ['Yes?', 'I’m listening.', 'Go ahead.', 'Tell me.'] as const;

export function wakeReply(turn: number): string {
  return WAKE_REPLIES[Math.abs(turn) % WAKE_REPLIES.length]!;
}

/**
 * Said just before the phone asks for the person's fingerprint, face or screen
 * lock. The assistant can get a payment ready and open the screen, but it
 * cannot confirm one: this is the moment it tells the person that part is
 * theirs. Not "signature", which the product never says to a person.
 */
export const CONFIRM_LINE = 'A quick fingerprint, and it’s done.';

/**
 * What it says when it has just been turned on, or when the app is opened with
 * "Hey Ayo" on: a greeting by name, and how to reach it. It should feel like
 * someone arriving, not like a setting changing.
 */
export function welcomeLine(kind: 'turned-on' | 'talking-on' | 'launch', firstName: string | null, greeting: string): string {
  const name = firstName ? `, ${firstName}` : '';
  if (kind === 'turned-on') {
    return `Hi${name}. I’m ${ASSISTANT_NAME}. Say “Hey ${ASSISTANT_NAME}” whenever you need me, and I’ll take care of the rest. Just give me your fingerprint when it counts.`;
  }
  if (kind === 'talking-on') {
    return `Hi${name}. I’m ${ASSISTANT_NAME}. Tap the microphone and tell me what you need. I can open anything, tell you your balance, and get a payment ready.`;
  }
  return `${greeting}${name}. I’m listening.`;
}

/** Said when it has got a payment ready and is stepping back. */
export const READY_LINE = 'It’s ready. Check it, and I’ll need you to confirm.';

/** When the person stops talking and the assistant has nothing to act on. */
export const DIDNT_CATCH = 'Sorry, I didn’t catch that.';

/** Said when the person goes quiet during a conversation. */
export const GOODBYE_LINES = ['Alright.', 'I’m here if you need me.'] as const;
