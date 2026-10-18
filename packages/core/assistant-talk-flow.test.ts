import { describe, expect, it } from 'vitest';

import {
  QUIET_COMPLETE_MS,
  QUIET_MOST_MS,
  QUIET_OPEN_MS,
  readApproval,
  endpointDelay,
  isEcho,
  isInterruption,
  novelWords,
  wordsOf,
} from './assistant-talk-flow';

describe('finishing a sentence', () => {
  it('waits the least for a request the app already understands', () => {
    expect(endpointDelay("what's my balance", true)).toBe(QUIET_COMPLETE_MS);
  });

  it('waits longer for anything it does not yet understand, and longer still for one or two words', () => {
    expect(endpointDelay('abeg help me with something small', false)).toBe(QUIET_OPEN_MS);
    expect(endpointDelay('hmm okay', false)).toBe(QUIET_OPEN_MS + 500);
  });

  it.each(['send five thousand to', 'I want to pay for', 'send money and', 'um', 'I need the'])(
    '"%s" is plainly not finished, so it waits longer',
    (said) => {
      expect(endpointDelay(said, false)).toBeGreaterThan(QUIET_OPEN_MS + 1000);
    },
  );

  it('never waits more than the ceiling', () => {
    expect(endpointDelay('um', false)).toBeLessThanOrEqual(QUIET_MOST_MS);
    expect(endpointDelay('send and', false)).toBeLessThanOrEqual(QUIET_MOST_MS);
  });

  it('gives a sentence that ends on a word still to come more time than one that has landed', () => {
    expect(endpointDelay('send 5000 to Ada', true)).toBeLessThan(endpointDelay('send 5000 to', true));
  });
});

describe('hearing its own voice', () => {
  const said = 'You have ₦12,500. Anything else I can do for you?';

  it('turns symbols and separators into the words they are spoken as', () => {
    expect(wordsOf('₦5,000, please!')).toEqual(['naira', '5000', 'please']);
  });

  it('knows its own sentence coming back from the speaker', () => {
    expect(isEcho('you have 12500 naira', said)).toBe(true);
    expect(isEcho('you have naira 12500 anything else I can do', said)).toBe(true);
    expect(isEcho('anything else I can do for', said)).toBe(true);
  });

  it('does not take a person talking over it for an echo', () => {
    expect(isEcho('no wait send five thousand to Ada', said)).toBe(false);
  });

  it('counts what is new in what was heard, not the figure it said, however it was written', () => {
    expect(novelWords('you have twelve thousand', said, { figuresAreEcho: true })).toEqual([]);
    // But a figure the person says after it is theirs.
    expect(novelWords('you have 5000', said)).toEqual(['5000']);
    expect(novelWords('you have savings', said)).toEqual(['savings']);
    expect(novelWords('anything els I can do', said)).toEqual([]);
  });

  it('hears nothing as an echo', () => {
    expect(isEcho('', said)).toBe(true);
  });

  it('does not take one or two new words, or a misheard word, for a person: its own voice does that', () => {
    expect(isInterruption('you have 12500 send money', said)).toEqual({ yes: false });
    expect(isInterruption('you have 12500 okay', said)).toEqual({ yes: false });
    // A recogniser writes the figure as words, or a word a letter off.
    expect(isInterruption('you have twelve thousand five hundred naira anything els I can do four you', said)).toEqual({ yes: false });
  });

  it('takes a good run of new words, mostly new, as a person talking over it', () => {
    const talking = isInterruption('no I want to send five thousand to Ada for rent', said);
    expect(talking.yes).toBe(true);
  });

  it('takes a single "stop" as an interruption', () => {
    expect(isInterruption('you have stop', said)).toEqual({ yes: true, words: ['stop'] });
    expect(isInterruption('wait', said)).toEqual({ yes: true, words: ['wait'] });
  });

  it('does not take its own words coming back as an interruption', () => {
    expect(isInterruption('anything else I can do for you', said)).toEqual({ yes: false });
  });
});

describe('saying yes', () => {
  it.each([
    'yes', 'Yes.', 'yeah', 'yep', 'yes please', 'sure', 'okay', 'ok go ahead', 'go ahead', 'send it', 'do it', 'confirm',
    'proceed', 'abeg do it', 'yes na', 'oya go', "let's go", 'alright', 'that is correct', 'perfect',
  ])('"%s" is a yes', (said) => {
    expect(readApproval(said)).toBe('yes');
  });

  it.each(['no', 'No.', 'nope', 'cancel', 'cancel it', 'stop', "don't", 'do not send it', 'no wait', 'wait', 'never mind', 'no go', 'abeg stop'])(
    '"%s" is a no',
    (said) => {
      expect(readApproval(said)).toBe('no');
    },
  );

  it.each([
    'send 5000 to Ada',
    'what is my balance',
    'change it to three thousand',
    'yes and also send money to Tunde for rent',
    'hello',
    '',
    'make it two thousand instead',
  ])('"%s" is neither: it is a new request, or nothing', (said) => {
    expect(readApproval(said)).toBeNull();
  });

  it('takes a no that has a yes-sounding word after it as a no', () => {
    expect(readApproval('no go ahead')).toBe('no');
    expect(readApproval('wait do not send')).toBe('no');
  });
});
