import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QUIET_COMPLETE_MS } from '@entole/core/assistant-talk-flow';

import { ECHO_TAIL_MS, FIRST_WORDS_MS, FOLLOW_UP_MS, createConversation, type Outcome, type Phase } from '../lib/conversation';

/**
 * A whole spoken conversation, driven by hand: what the microphone hears is fed
 * in as the running text it really produces, time is faked, and the voice
 * finishes a sentence only when the test says so.
 */
function harness(reply: Partial<Outcome> & { said?: string } = {}) {
  let now = 1_000_000;
  const phases: Phase[] = [];
  const captions: string[] = [];
  const asked: string[] = [];
  let finishSpeaking: (() => void) | null = null;
  const spokenLines: string[] = [];

  const deps = {
    run: vi.fn(async (text: string) => {
      asked.push(text);
      return { said: reply.said ?? 'Done.', moved: reply.moved ?? false, prepared: reply.prepared ?? false } satisfies Outcome;
    }),
    speak: vi.fn(
      (text: string) =>
        new Promise<void>((resolve) => {
          spokenLines.push(text);
          finishSpeaking = resolve;
        }),
    ),
    stopSpeaking: vi.fn(() => finishSpeaking?.()),
    clearEars: vi.fn(),
    needEars: vi.fn(async () => true),
    doneWithEars: vi.fn(),
    setPhase: vi.fn((phase: Phase) => phases.push(phase)),
    setCaption: vi.fn((caption: string) => captions.push(caption)),
    nudge: vi.fn(),
    canInterrupt: vi.fn(() => true),
    now: () => now,
  };
  const conversation = createConversation(deps);
  return {
    conversation,
    deps,
    phases,
    captions,
    asked,
    spokenLines,
    /** The voice finishes the sentence it is saying. */
    async endSpeech() {
      finishSpeaking?.();
      await vi.advanceTimersByTimeAsync(0);
    },
    async wait(ms: number) {
      now += ms;
      await vi.advanceTimersByTimeAsync(ms);
    },
  };
}

/** Just past the quiet after which a request it understands is taken as finished. */
const COMPLETE = QUIET_COMPLETE_MS + 100;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('waiting for the name', () => {
  it('ignores everything that is not for it, and keeps the text it searches short', async () => {
    const t = harness();
    t.conversation.hear('so I told him we should meet at five');
    await t.wait(10_000);
    expect(t.deps.run).not.toHaveBeenCalled();
    expect(t.phases).toEqual([]);
    t.conversation.hear('x'.repeat(200));
    expect(t.deps.clearEars).toHaveBeenCalled();
  });

  it('takes a request said in the same breath as the name, and waits for the person to finish', async () => {
    const t = harness({ said: 'You have ₦12,500.' });
    t.conversation.hear('hey ayo what is my balance');
    expect(t.deps.nudge).toHaveBeenCalledTimes(1);
    expect(t.phases).toContain('listening');
    // A request it understands outright is taken after a short pause, not at once.
    await t.wait(1_000);
    expect(t.deps.run).not.toHaveBeenCalled();
    await t.wait(COMPLETE - 1_000);
    expect(t.asked).toEqual(['what is my balance']);
    expect(t.phases).toContain('thinking');
  });
});

describe('letting the person finish', () => {
  it('does not cut off a sentence that stops on a word like "to"', async () => {
    const t = harness();
    t.conversation.hear('hey ayo send five thousand to');
    await t.wait(3_000);
    expect(t.deps.run).not.toHaveBeenCalled();
    // They carry on: the sentence completes and the wait starts again.
    t.conversation.hear('hey ayo send 5000 to Ada');
    await t.wait(1_000);
    expect(t.deps.run).not.toHaveBeenCalled();
    await t.wait(COMPLETE - 1_000);
    expect(t.asked).toEqual(['send 5000 to Ada']);
  });

  it('joins what the phone broke into pieces, because it hears one running text', async () => {
    const t = harness();
    t.conversation.hear('hey ayo I want to send some money');
    await t.wait(1_500);
    t.conversation.hear('hey ayo I want to send some money to my sister for her school fees');
    await t.wait(2_300);
    expect(t.deps.run).not.toHaveBeenCalled();
    await t.wait(300);
    expect(t.asked).toEqual(['I want to send some money to my sister for her school fees']);
  });

  it('waits longer for something it does not yet understand than for something it does', async () => {
    const t = harness();
    t.conversation.hear('hey ayo abeg tell me something nice');
    await t.wait(2_300);
    expect(t.deps.run).not.toHaveBeenCalled();
    await t.wait(300);
    expect(t.asked).toHaveLength(1);
  });
});

describe('being called by name alone', () => {
  it('answers, then listens, and takes what is said next', async () => {
    const t = harness({ said: 'You have ₦12,500.' });
    t.conversation.hear('hey ayo');
    expect(t.spokenLines).toHaveLength(1);
    expect(t.phases.at(-1)).toBe('speaking');
    await t.endSpeech();
    expect(t.phases.at(-1)).toBe('listening');
    // The microphone is open throughout; it was only emptied.
    expect(t.deps.needEars).not.toHaveBeenCalled();
    await t.wait(ECHO_TAIL_MS + 50);
    t.conversation.hear('what is my balance');
    await t.wait(COMPLETE);
    expect(t.asked).toEqual(['what is my balance']);
  });

  it('closes quietly if nobody says anything', async () => {
    const t = harness();
    t.conversation.hear('hey ayo');
    await t.endSpeech();
    await t.wait(FIRST_WORDS_MS + 100);
    expect(t.phases.at(-1)).toBe('off');
    expect(t.spokenLines).toHaveLength(1);
    expect(t.deps.run).not.toHaveBeenCalled();
    expect(t.deps.doneWithEars).toHaveBeenCalled();
  });
});

describe('a conversation', () => {
  it('stays open for a follow-up, without the name, and closes when they go quiet', async () => {
    const t = harness({ said: 'You have ₦12,500.' });
    t.conversation.hear('hey ayo what is my balance');
    await t.wait(COMPLETE);
    await t.endSpeech();
    expect(t.phases.at(-1)).toBe('listening');

    await t.wait(ECHO_TAIL_MS + 50);
    t.conversation.hear('and my savings');
    // Not a request it already understands, so it gives them a little longer.
    await t.wait(2_600);
    expect(t.asked).toEqual(['what is my balance', 'and my savings']);

    await t.endSpeech();
    await t.wait(FOLLOW_UP_MS + 100);
    expect(t.phases.at(-1)).toBe('off');
  });

  it('is done when something has been got ready to confirm: the next move is theirs', async () => {
    const t = harness({ said: 'Ada, ₦5,000. Check it, then confirm it yourself.', prepared: true, moved: true });
    t.conversation.hear('hey ayo send 5000 to Ada');
    await t.wait(COMPLETE);
    await t.endSpeech();
    expect(t.phases.at(-1)).toBe('off');
    expect(t.deps.doneWithEars).toHaveBeenCalled();
  });

  it('hands the earlier turns to the next one', async () => {
    const t = harness({ said: 'You have ₦12,500.' });
    t.conversation.hear('hey ayo what is my balance');
    await t.wait(COMPLETE);
    await t.endSpeech();
    await t.wait(ECHO_TAIL_MS + 50);
    t.conversation.hear('and my savings');
    // Not a request it already understands, so it gives them a little longer.
    await t.wait(2_600);
    expect(t.deps.run).toHaveBeenLastCalledWith('and my savings', [
      { from: 'you', text: 'what is my balance' },
      { from: 'assistant', text: 'You have ₦12,500.' },
    ]);
  });

  it('says it could not, and does not go on, when the request fails', async () => {
    const t = harness();
    t.deps.run.mockRejectedValueOnce(new Error('offline'));
    t.conversation.hear('hey ayo what is my balance');
    await t.wait(COMPLETE);
    expect(t.spokenLines.at(-1)).toMatch(/Nothing was changed/);
    await t.endSpeech();
    expect(t.phases.at(-1)).toBe('off');
  });
});

describe('talking while it talks', () => {
  it('does not mistake its own voice, coming back from the speaker, for the person', async () => {
    const t = harness({ said: 'You have ₦12,500. Anything else I can do for you?' });
    t.conversation.hear('hey ayo what is my balance');
    await t.wait(COMPLETE);
    expect(t.phases.at(-1)).toBe('speaking');
    t.conversation.hear('you have 12500 naira');
    t.conversation.hear('you have 12500 naira anything else I can do for');
    expect(t.deps.stopSpeaking).not.toHaveBeenCalled();
    expect(t.phases.at(-1)).toBe('speaking');
  });

  it('stops when the person talks over it, and takes what they said as the next request', async () => {
    const t = harness({ said: 'You have ₦12,500. Anything else I can do for you?' });
    t.conversation.hear('hey ayo what is my balance');
    await t.wait(COMPLETE);
    // The microphone is open the whole time it speaks; a person cuts in.
    await t.wait(1_000);
    t.conversation.hear('you have 12500 no wait send money to Ada');
    expect(t.deps.stopSpeaking).toHaveBeenCalledTimes(1);
    expect(t.phases.at(-1)).toBe('listening');
    expect(t.captions.at(-1)).toBe('no wait send money to ada');
    await t.wait(2_600);
    expect(t.asked.at(-1)).toMatch(/send money/);
  });

  it('ignores everything while it speaks when the person has turned talking over it off', async () => {
    const t = harness({ said: 'You have ₦12,500. Anything else I can do for you?' });
    t.deps.canInterrupt.mockReturnValue(false);
    t.conversation.hear('hey ayo what is my balance');
    await t.wait(COMPLETE);
    await t.wait(1_000);
    t.conversation.hear('stop no wait send money to Ada');
    expect(t.deps.stopSpeaking).not.toHaveBeenCalled();
    expect(t.phases.at(-1)).toBe('speaking');
  });

  it('does not stop itself for a few of its own words, misheard', async () => {
    const t = harness({ said: 'You have ₦12,500. Anything else I can do for you?' });
    t.conversation.hear('hey ayo what is my balance');
    await t.wait(COMPLETE);
    await t.wait(1_000);
    t.conversation.hear('you have twelve thousand five hundred naira anything els I can do four you now');
    expect(t.deps.stopSpeaking).not.toHaveBeenCalled();
  });

  it('stops for a single "stop"', async () => {
    const t = harness({ said: 'You have ₦12,500. Anything else I can do for you?' });
    t.conversation.hear('hey ayo what is my balance');
    await t.wait(COMPLETE);
    await t.wait(1_000);
    t.conversation.hear('stop');
    expect(t.deps.stopSpeaking).toHaveBeenCalledTimes(1);
  });

  it('leaves the end of its own voice out of the next request, and keeps a quick answer', async () => {
    const t = harness({ said: 'You have ₦12,500. Anything else?' });
    t.conversation.hear('hey ayo what is my balance');
    await t.wait(COMPLETE);
    await t.endSpeech();
    // The tail of its sentence still arrives, and the person starts to answer at once.
    await t.wait(200);
    t.conversation.hear('anything else send 5000');
    await t.wait(ECHO_TAIL_MS);
    expect(t.deps.clearEars).toHaveBeenCalled();
    t.conversation.hear('to Ada');
    await t.wait(COMPLETE);
    expect(t.asked.at(-1)).toBe('send 5000 to Ada');
  });
});

describe('its last words, coming back late', () => {
  it('does not take the end of its own sentence, arriving well after it stopped, for a request', async () => {
    const t = harness({ said: 'You have ₦12,500. Anything else I can do for you?' });
    t.conversation.hear('hey ayo what is my balance');
    await t.wait(COMPLETE);
    await t.endSpeech();
    // The tail window has passed; the recogniser is only now writing down the last words.
    await t.wait(ECHO_TAIL_MS + 1_000);
    t.conversation.hear('anything else I can do for you');
    await t.wait(4_000);
    expect(t.asked).toEqual(['what is my balance']);
    expect(t.deps.clearEars).toHaveBeenCalled();
  });

  it('is still listening afterwards, and takes the real request when it comes', async () => {
    const t = harness({ said: 'You have ₦12,500. Anything else I can do for you?' });
    t.conversation.hear('hey ayo what is my balance');
    await t.wait(COMPLETE);
    await t.endSpeech();
    await t.wait(ECHO_TAIL_MS + 1_000);
    t.conversation.hear('can do for you');
    await t.wait(500);
    t.conversation.hear('open receive');
    await t.wait(COMPLETE);
    expect(t.asked.at(-1)).toBe('open receive');
  });

  it('closes after the quiet if nothing but its own echo was heard', async () => {
    const t = harness({ said: 'You have ₦12,500. Anything else I can do for you?' });
    t.conversation.hear('hey ayo what is my balance');
    await t.wait(COMPLETE);
    await t.endSpeech();
    await t.wait(ECHO_TAIL_MS + 1_000);
    t.conversation.hear('else I can do for you');
    await t.wait(8_000);
    expect(t.phases.at(-1)).toBe('off');
    expect(t.asked).toHaveLength(1);
  });

  it('still takes a real request that shares a word or two with what it said', async () => {
    const t = harness({ said: 'You have ₦12,500. Anything else I can do for you?' });
    t.conversation.hear('hey ayo what is my balance');
    await t.wait(COMPLETE);
    await t.endSpeech();
    await t.wait(ECHO_TAIL_MS + 1_000);
    t.conversation.hear('send 5000 to Ada');
    await t.wait(COMPLETE);
    expect(t.asked.at(-1)).toBe('send 5000 to Ada');
  });
});

describe('the microphone button', () => {
  it('opens the microphone if it is not open, and listens without the name', async () => {
    const t = harness({ said: 'You have ₦12,500.' });
    await t.conversation.summon();
    expect(t.deps.needEars).toHaveBeenCalledTimes(1);
    expect(t.phases.at(-1)).toBe('listening');
    t.conversation.hear('what is my balance');
    await t.wait(COMPLETE);
    expect(t.asked).toEqual(['what is my balance']);
  });

  it('says so when it heard nothing after a tap', async () => {
    const t = harness();
    await t.conversation.summon();
    await t.wait(FIRST_WORDS_MS + 100);
    expect(t.spokenLines).toEqual(['Sorry, I didn’t catch that.']);
    await t.endSpeech();
    expect(t.phases.at(-1)).toBe('off');
  });

  it('stops everything when tapped again', async () => {
    const t = harness();
    await t.conversation.summon();
    await t.conversation.summon();
    expect(t.phases.at(-1)).toBe('off');
    expect(t.deps.stopSpeaking).toHaveBeenCalled();
  });

  it('does nothing if the microphone cannot be opened', async () => {
    const t = harness();
    t.deps.needEars.mockResolvedValueOnce(false);
    await t.conversation.summon();
    expect(t.phases).toEqual([]);
  });
});

describe('putting it away', () => {
  it('drops a request that was on its way when the person stopped it', async () => {
    const t = harness({ said: 'You have ₦12,500.' });
    let answer: (outcome: Outcome) => void = () => undefined;
    t.deps.run.mockImplementationOnce(() => new Promise<Outcome>((resolve) => (answer = resolve)));
    t.conversation.hear('hey ayo what is my balance');
    await t.wait(COMPLETE);
    expect(t.phases.at(-1)).toBe('thinking');
    t.conversation.dismiss();
    answer({ said: 'You have ₦12,500.', moved: true, prepared: false });
    await t.wait(100);
    expect(t.phases.at(-1)).toBe('off');
    expect(t.spokenLines).toEqual([]);
  });

  it('does not take a request that has not been finished when it is stopped', async () => {
    const t = harness();
    t.conversation.hear('hey ayo what is my balance');
    await t.wait(500);
    t.conversation.dismiss();
    await t.wait(5_000);
    expect(t.deps.run).not.toHaveBeenCalled();
  });

  it('says that the next part is theirs, and then goes back to waiting', async () => {
    const t = harness();
    const done = vi.fn();
    const announced = t.conversation.announce('I’ll need you to confirm this yourself.', done);
    expect(t.phases.at(-1)).toBe('confirming');
    // What the microphone hears of that sentence is not taken for a person talking over it.
    t.conversation.hear('I’ll need you to confirm this yourself and then some');
    expect(t.deps.stopSpeaking).not.toHaveBeenCalled();
    await t.endSpeech();
    await announced;
    expect(done).toHaveBeenCalledTimes(1);
    expect(t.phases.at(-1)).toBe('off');
  });
});

describe('asking a question about the screen', () => {
  const question = 'Sending ₦5,000 to Ada Eze. The fee is ₦250, so ₦5,250 leaves your account. Shall I send it?';

  function asked() {
    const t = harness();
    const yes = vi.fn();
    const no = vi.fn();
    const offer = { say: question, yes, no, declined: 'Okay, I’ve left it. Nothing was sent.' };
    return { t, yes, no, offer };
  }

  it('says the question, then listens for the answer', async () => {
    const { t, offer } = asked();
    void t.conversation.offer(offer);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.spokenLines).toEqual([question]);
    expect(t.phases.at(-1)).toBe('speaking');
    await t.endSpeech();
    expect(t.phases.at(-1)).toBe('listening');
  });

  it('calls yes on a spoken yes, once the person has stopped, and nothing before', async () => {
    const { t, yes, offer } = asked();
    void t.conversation.offer(offer);
    await vi.advanceTimersByTimeAsync(0);
    await t.endSpeech();
    await t.wait(ECHO_TAIL_MS + 50);
    t.conversation.hear('yes');
    expect(yes).not.toHaveBeenCalled();
    await t.wait(900);
    expect(yes).toHaveBeenCalledTimes(1);
    expect(t.phases.at(-1)).toBe('off');
    expect(t.deps.run).not.toHaveBeenCalled();
  });

  it.each(['go ahead', 'send it', 'abeg do it', 'okay'])('takes "%s" as a yes', async (said) => {
    const { t, yes, offer } = asked();
    void t.conversation.offer(offer);
    await vi.advanceTimersByTimeAsync(0);
    await t.endSpeech();
    await t.wait(ECHO_TAIL_MS + 50);
    t.conversation.hear(said);
    await t.wait(900);
    expect(yes).toHaveBeenCalledTimes(1);
  });

  it('calls no on a no, says it has left it, and does not send', async () => {
    const { t, yes, no, offer } = asked();
    void t.conversation.offer(offer);
    await vi.advanceTimersByTimeAsync(0);
    await t.endSpeech();
    await t.wait(ECHO_TAIL_MS + 50);
    t.conversation.hear('no wait');
    await t.wait(900);
    expect(no).toHaveBeenCalledTimes(1);
    expect(yes).not.toHaveBeenCalled();
    expect(t.spokenLines.at(-1)).toBe('Okay, I’ve left it. Nothing was sent.');
  });

  it('takes a yes said before she has finished asking', async () => {
    const { t, yes, offer } = asked();
    void t.conversation.offer(offer);
    await vi.advanceTimersByTimeAsync(0);
    await t.wait(1_500);
    t.conversation.hear('yes');
    expect(t.deps.stopSpeaking).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(yes).toHaveBeenCalledTimes(1);
  });

  it('does not take her own question coming back from the speaker for an answer', async () => {
    const { t, yes, no, offer } = asked();
    void t.conversation.offer(offer);
    await vi.advanceTimersByTimeAsync(0);
    await t.wait(1_500);
    t.conversation.hear('shall I send it');
    t.conversation.hear('sending 5000 naira to Ada Eze the fee is 250 so shall I send it');
    await t.wait(3_000);
    expect(yes).not.toHaveBeenCalled();
    expect(no).not.toHaveBeenCalled();
    expect(t.deps.stopSpeaking).not.toHaveBeenCalled();
  });

  it('reads something else as a new request, and does not send', async () => {
    const { t, yes, offer } = asked();
    void t.conversation.offer(offer);
    await vi.advanceTimersByTimeAsync(0);
    await t.endSpeech();
    await t.wait(ECHO_TAIL_MS + 50);
    t.conversation.hear('what is my balance');
    await t.wait(2_000);
    expect(t.asked).toEqual(['what is my balance']);
    expect(yes).not.toHaveBeenCalled();
  });

  it('leaves the screen as it is, and says how to go on, when no one answers', async () => {
    const { t, yes, offer } = asked();
    void t.conversation.offer(offer);
    await vi.advanceTimersByTimeAsync(0);
    await t.endSpeech();
    await t.wait(15_100);
    expect(t.spokenLines.at(-1)).toBe('Say yes when you’re ready, or tap Send yourself.');
    expect(yes).not.toHaveBeenCalled();
    await t.endSpeech();
    expect(t.phases.at(-1)).toBe('off');
  });

  it('still takes a yes later, when they come back with the name', async () => {
    const { t, yes, offer } = asked();
    void t.conversation.offer(offer);
    await vi.advanceTimersByTimeAsync(0);
    await t.endSpeech();
    await t.wait(15_100);
    await t.endSpeech();
    t.conversation.hear('hey ayo yes');
    await t.wait(900);
    expect(yes).toHaveBeenCalledTimes(1);
  });

  it('can no longer be answered once the screen that asked has gone', async () => {
    const { t, yes, offer } = asked();
    void t.conversation.offer(offer);
    await vi.advanceTimersByTimeAsync(0);
    await t.endSpeech();
    t.conversation.withdraw(offer);
    expect(t.phases.at(-1)).toBe('off');
    t.conversation.hear('hey ayo yes');
    await t.wait(2_000);
    expect(yes).not.toHaveBeenCalled();
  });

  it('is answered only once, however many times the person says yes', async () => {
    const { t, yes, offer } = asked();
    void t.conversation.offer(offer);
    await vi.advanceTimersByTimeAsync(0);
    await t.endSpeech();
    await t.wait(ECHO_TAIL_MS + 50);
    t.conversation.hear('yes');
    await t.wait(900);
    t.conversation.hear('hey ayo yes');
    await t.wait(900);
    expect(yes).toHaveBeenCalledTimes(1);
  });

  it('only says the question, and does not wait for an answer, when it cannot hear', async () => {
    const { t, yes, offer } = asked();
    t.deps.needEars.mockResolvedValueOnce(false);
    void t.conversation.offer(offer);
    await vi.advanceTimersByTimeAsync(0);
    await t.endSpeech();
    expect(t.phases.at(-1)).toBe('off');
    expect(yes).not.toHaveBeenCalled();
  });

  it('says a line with no question, such as that a payment did not go through', async () => {
    const t = harness();
    void t.conversation.tell('That payment didn’t go through. Nothing was taken.');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.spokenLines).toEqual(['That payment didn’t go through. Nothing was taken.']);
    await t.endSpeech();
    expect(t.phases.at(-1)).toBe('off');
  });
});
