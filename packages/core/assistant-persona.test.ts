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
  welcomeLine,
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
  it.each([
    'hey iyo', 'hey ayoh', 'hey a yo', 'hey ayyo', 'hey aayo', 'hi eyo', 'heyo', 'hayo', 'hiyo', 'hey I O', 'hey, ayu',
    'hello ayoo', 'okay a you', 'hey I your', 'hey I yo', 'hey eye yo', 'hey I you', 'hi I-yo', 'hey ai yo', 'hello eye your', 'okay I yore', 'hey ahyo', 'hey io', 'Hey Ayo.', 'hey  ayo', 'yo ayo', 'hay oh', 'hey ayeo', 'iyo',
  ])('hears the name as "%s"', (heard) => {
    expect(readWake(heard).woke).toBe(true);
  });

  it('takes what follows the name however it was written', () => {
    expect(readWake('heyo what is my balance')).toEqual({ woke: true, rest: 'what is my balance' });
    expect(readWake('hey iyo, send 5000 to Ada')).toEqual({ woke: true, rest: 'send 5000 to Ada' });
    expect(readWake('hi a yo open receive')).toEqual({ woke: true, rest: 'open receive' });
    expect(readWake('hey I your what is my balance')).toEqual({ woke: true, rest: 'what is my balance' });
    expect(readWake('hey eye yo, send 5000 to Ada')).toEqual({ woke: true, rest: 'send 5000 to Ada' });
  });

  it.each([
    'what is my balance',
    'hey there',
    'send money to Ayodele',
    'hello, how are you',
    'I said hey to my brother',
    'the layout was ayo',
    'hey there how are you',
    'oh no I forgot',
    'okay so we should go',
    'hello my friend',
    'hey you',
    'hi Ayodele how are you',
    'I you know what I mean',
    'I your honour',
    'hey I owe you money',
    'hello I am here',
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

describe('welcoming the person', () => {
  it('greets them by name, and says how to reach it', () => {
    expect(welcomeLine('turned-on', 'Ngozi', 'Good evening')).toMatch(/^Hi, Ngozi\. I’m Ayo\./);
    expect(welcomeLine('turned-on', 'Ngozi', 'Good evening')).toMatch(/Hey Ayo/);
    expect(welcomeLine('talking-on', 'Ngozi', 'Good evening')).toMatch(/Tap the microphone/);
    expect(welcomeLine('launch', 'Ngozi', 'Good evening')).toBe('Good evening, Ngozi. I’m listening.');
  });

  it('copes with not knowing a name', () => {
    expect(welcomeLine('turned-on', null, 'Good evening')).toMatch(/^Hi\. I’m Ayo\./);
    expect(welcomeLine('launch', null, 'Good morning')).toBe('Good morning. I’m listening.');
  });

  it('never says a word the product never says', () => {
    const never = /\b(wallet|crypto\w*|blockchain|on-?chain|chain|gas|token|signature|seed)\b/i;
    for (const kind of ['turned-on', 'talking-on', 'launch'] as const) {
      expect(welcomeLine(kind, 'Ngozi', 'Good evening')).not.toMatch(never);
    }
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
    expect(CONFIRM_LINE).toMatch(/fingerprint/);
    expect(READY_LINE).toMatch(/confirm/);
  });
});
