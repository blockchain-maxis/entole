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

/**
 * Whether the assistant was called, and what was said after its name in the
 * same breath. "Hey Ayo, what's my balance" wakes it with "what's my balance";
 * "hey Ayo" alone wakes it with nothing, and it asks what is needed.
 */
export function readWake(heard: string): Wake {
  const match = WAKE.exec(heard);
  if (!match) return { woke: false };
  const rest = heard
    .slice(match.index + match[0].length)
    .replace(/\s+/g, ' ')
    .trim();
  return { woke: true, rest };
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
export const CONFIRM_LINE = 'I’ll need you to confirm this yourself.';

/** Said when it has got a payment ready and is stepping back. */
export const READY_LINE = 'It’s ready. Check it, and I’ll need you to confirm.';

/** When the person stops talking and the assistant has nothing to act on. */
export const DIDNT_CATCH = 'Sorry, I didn’t catch that.';

/** Said when the person goes quiet during a conversation. */
export const GOODBYE_LINES = ['Alright.', 'I’m here if you need me.'] as const;
