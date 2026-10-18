import { describe, expect, it } from 'vitest';

import {
  ACCENTS,
  ASSISTANT_NAME,
  CONFIRM_LINE,
  DEFAULT_ACCENT_ID,
  READY_LINE,
  WAKE_REPLIES,
  accentFor,
  readWake,
  wakeReply,
  withoutName,
} from './assistant-persona';

describe('being woken', () => {
  it.each([
    ['hey ayo', ''],
    ['Hey Ayo', ''],
    ['hey Ayo, what is my balance', 'what is my balance'],
    ['Hi Ayo send 5000 to Ada', 'send 5000 to Ada'],
    ['okay ayo take me home', 'take me home'],
    ['so anyway hey ayo what is my balance?', 'what is my balance?'],
    ['Ayo, open receive', 'open receive'],
    ['ayo', ''],
  ])('"%s" wakes it, with "%s" after', (heard, rest) => {
    expect(readWake(heard)).toEqual({ woke: true, rest });
  });

  // A recogniser that has never been told the name writes what it hears.
  it.each(['hey iyo', 'hey ayoh', 'hey a yo', 'hey ayyo', 'hey aayo', 'hi eyo'])('hears the name as "%s"', (heard) => {
    expect(readWake(heard).woke).toBe(true);
  });

  it.each([
    'what is my balance',
    'hey there',
    'send money to Ayodele',
    'hello, how are you',
    'I said hey to my brother',
    'the layout was ayo',
    '',
  ])('"%s" does not wake it', (heard) => {
    expect(readWake(heard).woke).toBe(false);
  });

  it('takes the name off the front and leaves the request', () => {
    expect(withoutName('hey ayo send 5k to Tunde')).toBe('send 5k to Tunde');
    expect(withoutName('send 5k to Tunde')).toBe('send 5k to Tunde');
  });

  it('is called by the name it is given', () => {
    expect(ASSISTANT_NAME).toBe('Ayo');
    expect(readWake(`hey ${ASSISTANT_NAME}`).woke).toBe(true);
  });
});

describe('how it sounds', () => {
  it('starts with Nigerian English, and an unknown accent falls back to it', () => {
    expect(ACCENTS[0]).toMatchObject({ id: 'ng', listen: 'en-NG', speak: 'en-NG' });
    expect(DEFAULT_ACCENT_ID).toBe('ng');
    expect(accentFor('ng').label).toBe('Nigerian English');
    expect(accentFor('gone').id).toBe('ng');
    expect(accentFor(null).id).toBe('ng');
  });

  it('every accent names the language to listen for and to speak', () => {
    for (const accent of ACCENTS) {
      expect(accent.id).toMatch(/^[a-z]+$/);
      expect(accent.listen).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
      expect(accent.speak).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
    expect(new Set(ACCENTS.map((accent) => accent.id)).size).toBe(ACCENTS.length);
  });
});

describe('what it always says', () => {
  it('rotates how it answers its name', () => {
    expect(wakeReply(0)).toBe(WAKE_REPLIES[0]);
    expect(wakeReply(WAKE_REPLIES.length)).toBe(WAKE_REPLIES[0]);
    expect(new Set(WAKE_REPLIES.map((_, turn) => wakeReply(turn))).size).toBe(WAKE_REPLIES.length);
  });

  it('tells the person that confirming is theirs, without a word the product never says', () => {
    const never = /\b(wallet|crypto\w*|blockchain|on-?chain|chain|gas|token|seed|recovery phrase|transaction hash|signature)\b/i;
    for (const line of [CONFIRM_LINE, READY_LINE, ...WAKE_REPLIES]) expect(line).not.toMatch(never);
    expect(CONFIRM_LINE).toMatch(/confirm/);
    expect(READY_LINE).toMatch(/confirm/);
  });
});
