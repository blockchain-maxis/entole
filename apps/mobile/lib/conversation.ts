import { readPlainRequest } from '@entole/core/assistant-actions';
import type { TurnHistory } from '@entole/core/assistant-brain';
import { DIDNT_CATCH, readWake, wakeReply } from '@entole/core/assistant-persona';
import { STILL_THERE_LINE } from '@entole/core/assistant-voice-lines';
import { endpointDelay, isEcho, isInterruption, novelWords, readApproval } from '@entole/core/assistant-talk-flow';

import type { Offer } from './voice-offers';

/**
 * One spoken conversation with the assistant, as a state machine over a
 * microphone that stays open.
 *
 * The microphone (`openEars` in `lib/voice.ts`) never stops listening: it hands
 * this module everything it hears, as one running piece of text. This module
 * decides what that text means:
 *
 * - **idle** — listening only for the assistant's name. Anything else is
 *   ignored, and the buffer is trimmed so it never grows.
 * - **capturing** — a sentence is being said. It is finished when the person
 *   has been quiet long enough (`endpointDelay`: short for a request the app
 *   fully understands, longer for anything else, longer still when the last
 *   word is "and" or "to"), not when the phone decides, which cut people off.
 * - **thinking** — the request is being carried out. What is heard meanwhile is
 *   ignored.
 * - **speaking** — the assistant is talking, and the microphone is still on. Its
 *   own voice coming back from the speaker is recognised by its words and
 *   dropped; a person talking over it stops it and becomes the next request.
 *
 * After it has spoken the conversation stays open for a follow-up, with no need
 * to say the name again, and closes when the person goes quiet, or when
 * something has been got ready for them to confirm (the next move is theirs).
 *
 * Nothing here knows about React, the recogniser or the voice: the screen gives
 * it those, which is also what lets a test drive a whole conversation.
 */

export type Phase = 'off' | 'waiting' | 'listening' | 'thinking' | 'speaking' | 'confirming';

export type Outcome = { said: string; moved: boolean; prepared: boolean };

export type ConversationDeps = {
  /** Carries out one request: the same runner the typed assistant uses. */
  run: (text: string, history: TurnHistory) => Promise<Outcome>;
  /** Says a sentence. Resolves when it has been said, or cut off. */
  speak: (text: string) => Promise<void>;
  stopSpeaking: () => void;
  /** Empties the microphone's running text. */
  clearEars: () => void;
  /** Makes sure the microphone is open (it is already, while waiting for the name). `false` when it cannot be. */
  needEars: () => Promise<boolean>;
  /** Says the microphone is no longer needed for a conversation. It stays open if the name is being waited for. */
  doneWithEars: () => void;
  setPhase: (phase: Phase) => void;
  setCaption: (caption: string) => void;
  /** A short, physical sign that the assistant was called. */
  nudge: () => void;
  /** Whether the person may talk over the assistant. Off, the microphone ignores everything while it speaks. */
  canInterrupt: () => boolean;
  now: () => number;
};

/**
 * How long the assistant stays actively listening, with no need to say its name
 * again, after it has been called and after each answer. Ninety seconds of
 * silence returns it to listening for the name alone, in the background. A tap
 * on the microphone is shorter: someone who tapped and said nothing was not
 * mid-conversation.
 */
export const FIRST_WORDS_MS = 90_000;
export const FOLLOW_UP_MS = 90_000;
export const TAP_WAIT_MS = 15_000;
export const MOST_TURNS = 40;
/** How long it waits for a yes or a no to a question about a payment, and how long a yes or no must be followed by quiet. */
export const APPROVAL_WAIT_MS = 15_000;
export const APPROVAL_QUIET_MS = 800;
/** The last of its own voice is still in the air for a moment after it stops. */
export const ECHO_TAIL_MS = 1500;
/**
 * How long after it stops talking a request made only of its own last words is
 * taken to be its echo. The speaker plays on a moment after the voice reports it
 * is done, and the recogniser takes a second or more to write down what it heard,
 * so the end of a sentence can arrive well after the sentence is over.
 */
export const ECHO_MEMORY_MS = 10_000;
/**
 * The same, for a yes. Her question ends in the words that answer it ("shall I send
 * it?"), so its late echo reads as a yes. A yes made only of her own words is
 * ignored for this long after she stops; a yes with a word of its own ("yes",
 * "okay") counts at once.
 */
export const ECHO_VERDICT_MS = 6000;

type Mode = 'idle' | 'capturing' | 'thinking' | 'speaking';

export function createConversation(deps: ConversationDeps) {
  let mode: Mode = 'idle';
  /** Bumped to cancel whatever is in flight. */
  let token = 0;
  let silence: ReturnType<typeof setTimeout> | null = null;
  let quiet: ReturnType<typeof setTimeout> | null = null;
  let spoken = '';
  let echoUntil = 0;
  /** Words said over the assistant that began the sentence now being captured. */
  let seed = '';
  let history: TurnHistory = [];
  let turns = 0;
  let greeted = 0;
  let followUp = false;
  let byName = false;
  let announcing = false;
  /** The question being asked right now, and the last one asked that has not been answered or withdrawn. */
  let approval: Offer | null = null;
  let standing: Offer | null = null;
  /** Just after the assistant stops, the last of its voice is still arriving: what is heard then is sorted into its words and the person's. */
  let tail: { spoken: string; timer: ReturnType<typeof setTimeout> } | null = null;
  let lastHeard = '';
  /** The last thing it said, and when it finished, to tell a late echo of it from a request. */
  let lastSpoken: { text: string; at: number } | null = null;

  /** Empties the microphone's text, and forgets what we last saw of it. */
  const emptyEars = () => {
    lastHeard = '';
    deps.clearEars();
  };

  const stopTimers = () => {
    if (silence) clearTimeout(silence);
    if (quiet) clearTimeout(quiet);
    if (tail) clearTimeout(tail.timer);
    silence = null;
    quiet = null;
    tail = null;
  };

  function finish() {
    stopTimers();
    mode = 'idle';
    approval = null;
    seed = '';
    spoken = '';
    history = [];
    turns = 0;
    followUp = false;
    emptyEars();
    deps.setCaption('');
    deps.setPhase('off');
    deps.doneWithEars();
  }

  /** The request in what was heard: what comes after the name, or all of it. */
  function commandIn(heard: string): string {
    const wake = readWake(heard);
    const after = wake.woke ? wake.rest : heard;
    return [seed, after].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  /** What was heard after the name, if the name is in it. */
  function commandOnly(heard: string): string {
    const wake = readWake(heard);
    return wake.woke ? wake.rest : heard;
  }

  function listenFor(ms: number) {
    mode = 'capturing';
    emptyEars();
    deps.setCaption('');
    deps.setPhase('listening');
    if (quiet) clearTimeout(quiet);
    const mine = token;
    quiet = setTimeout(() => {
      if (mine !== token || mode !== 'capturing') return;
      // A question left unanswered: it says the way back, and leaves the screen as it is.
      if (approval) {
        approval = null;
        void say(STILL_THERE_LINE).then(() => mine === token && finish());
        return;
      }
      // Silence after an answer is just the end. Silence after being called by a
      // tap means the tap was heard and nothing followed: say so.
      if (!followUp && !byName) {
        void say(DIDNT_CATCH).then(() => mine === token && finish());
        return;
      }
      finish();
    }, ms);
  }

  async function say(text: string, as: Phase = 'speaking'): Promise<void> {
    mode = 'speaking';
    spoken = text;
    emptyEars();
    deps.setPhase(as);
    deps.setCaption(text);
    await deps.speak(text);
    echoUntil = deps.now() + ECHO_TAIL_MS;
    lastSpoken = { text, at: deps.now() };
  }

  /** Whether this is only the end of what it last said, coming back through the speaker late. */
  function isLateEcho(command: string, within = ECHO_MEMORY_MS): boolean {
    return lastSpoken !== null && deps.now() - lastSpoken.at < within && isEcho(command, lastSpoken.text);
  }

  /**
   * The assistant has just stopped, and a follow-up is open. For a moment the
   * microphone is still hearing the end of its voice; the person may also have
   * started to answer at once. Words that were in the assistant's sentence are
   * set aside, anything else is kept as the start of what they say, and then the
   * microphone is emptied so the echo cannot leak into the request.
   */
  function startTail(said: string) {
    if (tail) clearTimeout(tail.timer);
    const mine = token;
    tail = {
      spoken: said,
      timer: setTimeout(() => {
        if (mine !== token) return;
        const own = novelWords(lastHeard, said).join(' ');
        tail = null;
        seed = [seed, own].filter(Boolean).join(' ');
        emptyEars();
        deps.setCaption(seed);
      }, ECHO_TAIL_MS),
    };
  }

  /** A yes or a no to the question on the screen. A yes presses the screen's own button; the fingerprint is still the person's. */
  function resolve(verdict: 'yes' | 'no', mine: number) {
    const asked = approval ?? standing;
    if (!asked || mine !== token) return;
    approval = null;
    standing = null;
    stopTimers();
    if (verdict === 'yes') {
      finish();
      asked.yes();
      return;
    }
    asked.no?.();
    if (asked.declined) void say(asked.declined).then(() => mine === token && finish());
    else finish();
  }

  async function submit(command: string, mine: number) {
    // A question was left open and they have come back to it ("Hey Ayo, yes").
    const answer = standing && !approval ? readApproval(command) : null;
    if (answer) return resolve(answer, mine);
    approval = null;
    stopTimers();
    mode = 'thinking';
    seed = '';
    emptyEars();
    deps.setPhase('thinking');
    deps.setCaption(command);

    let outcome: Outcome;
    try {
      outcome = await deps.run(command, history);
    } catch {
      if (mine !== token) return;
      await say('That didn’t work. Nothing was changed.');
      if (mine === token) finish();
      return;
    }
    if (mine !== token) return;

    history = [...history, { from: 'you' as const, text: command }, ...(outcome.said ? [{ from: 'assistant' as const, text: outcome.said }] : [])].slice(-6);
    turns += 1;

    if (outcome.said) {
      await say(outcome.said);
      // Talked over: the interruption has already started the next request.
      if (mine !== token || (mode as Mode) !== 'speaking') return;
    }
    // Something is ready for them to confirm. It is theirs now.
    if (outcome.prepared || turns >= MOST_TURNS) {
      finish();
      return;
    }
    followUp = true;
    const said = outcome.said;
    listenFor(FOLLOW_UP_MS);
    if (said) startTail(said);
  }

  /** Begins a conversation: by the name (with whatever followed it) or by a tap. */
  function begin(kind: 'name' | 'tap') {
    token += 1;
    stopTimers();
    byName = kind === 'name';
    followUp = false;
    seed = '';
    history = [];
    turns = 0;
    deps.nudge();
  }

  function onCapturing(heard: string) {
    lastHeard = heard;
    // While the end of its own voice may still be arriving, only what it did not say counts.
    const command = tail ? [seed, novelWords(commandOnly(heard), tail.spoken).join(' ')].filter(Boolean).join(' ') : commandIn(heard);
    // Only the end of its own last sentence, arriving late: not a request. Forget it and carry on listening.
    // A yes to its question may share its words ("send it" answers "shall I send it?"), which is also exactly
    // what its echo sounds like, so a yes made only of its own words has to wait out a longer echo window.
    const asking = approval !== null || standing !== null;
    const echoWindow = asking && readApproval(command) ? ECHO_VERDICT_MS : ECHO_MEMORY_MS;
    if (!tail && !seed && command && isLateEcho(commandOnly(heard), echoWindow)) {
      emptyEars();
      deps.setCaption('');
      return;
    }
    deps.setCaption(command);
    if (!command) return;
    if (quiet) clearTimeout(quiet);
    quiet = null;
    if (silence) clearTimeout(silence);
    const mine = token;
    // A plain yes or no is taken after a short pause: it is the whole answer.
    const verdict = approval || standing ? readApproval(command) : null;
    silence = setTimeout(() => {
      if (mine !== token || mode !== 'capturing') return;
      if (verdict) resolve(verdict, mine);
      else void submit(command, mine);
    }, verdict ? APPROVAL_QUIET_MS : endpointDelay(command, readPlainRequest(command) !== null));
  }

  function onSpeaking(heard: string) {
    if (announcing || !deps.canInterrupt() || deps.now() < echoUntil) return;
    // "Yes" before she has finished asking is still a yes. (Her own words are not counted.)
    if (approval) {
      const verdict = readApproval(novelWords(heard, spoken).join(' '));
      if (verdict) {
        deps.stopSpeaking();
        token += 1;
        approval = approval ?? standing;
        return resolve(verdict, token);
      }
    }
    const talking = isInterruption(heard, spoken);
    if (!talking.yes) return;
    // Someone is talking over it. It stops, and what they have said so far starts their next request.
    deps.stopSpeaking();
    token += 1;
    followUp = true;
    seed = talking.words.join(' ');
    mode = 'capturing';
    emptyEars();
    deps.setPhase('listening');
    deps.setCaption(seed);
    const mine = token;
    if (silence) clearTimeout(silence);
    silence = setTimeout(() => {
      if (mine !== token || mode !== 'capturing') return;
      void submit(seed, mine);
    }, endpointDelay(seed, readPlainRequest(seed) !== null));
  }

  /** Says one line the person must not talk over, runs `then`, and puts everything away. */
  async function announce(text: string, then: () => void, as: Phase = 'confirming') {
    token += 1;
    stopTimers();
    announcing = true;
    const mine = token;
    await say(text, as);
    if (mine !== token) return;
    announcing = false;
    then();
    finish();
  }

  function dismiss() {
    token += 1;
    deps.stopSpeaking();
    announcing = false;
    finish();
  }

  return {
    /** Everything the microphone has heard since it was last emptied. */
    hear(heard: string) {
      if (mode === 'thinking') return;
      if (mode === 'speaking') return onSpeaking(heard);

      if (mode === 'idle') {
        const wake = readWake(heard);
        if (!wake.woke) {
          // Not for us. Keep the buffer short so it is cheap to search.
          if (heard.length > 160) emptyEars();
          return;
        }
        begin('name');
        mode = 'capturing';
        deps.setPhase('listening');
        if (wake.rest) return onCapturing(heard);
        // Called by name and nothing more: answer, then listen.
        const mine = token;
        const line = wakeReply(greeted);
        greeted += 1;
        void say(line).then(() => {
          if (mine !== token || mode !== 'speaking') return;
          listenFor(FIRST_WORDS_MS);
          startTail(line);
        });
        return;
      }

      onCapturing(heard);
    },

    /** The microphone button: start listening now, without the name. */
    async summon() {
      if (mode !== 'idle') {
        dismiss();
        return;
      }
      if (!(await deps.needEars())) return;
      begin('tap');
      listenFor(TAP_WAIT_MS);
    },

    /** Stops listening and speaking, and puts everything away. */
    dismiss,

    /** Asks the person something about what is on the screen, and waits for yes or no. */
    async offer(asked: Offer) {
      token += 1;
      stopTimers();
      standing = asked;
      approval = asked;
      history = [];
      followUp = true;
      byName = true;
      seed = '';
      turns = 0;
      const mine = token;
      const hears = await deps.needEars();
      if (mine !== token) return;
      await say(asked.say);
      // Answered over her, or put away: whoever did that has taken it from here.
      if (mine !== token || (mode as Mode) !== 'speaking') return;
      if (!hears) {
        finish();
        return;
      }
      listenFor(APPROVAL_WAIT_MS);
      startTail(asked.say);
    },

    /** The screen that asked has gone: nothing may answer it any more. */
    withdraw(asked: Offer) {
      if (standing === asked) standing = null;
      if (approval === asked) {
        approval = null;
        dismiss();
      }
    },

    /** Says something with no answer expected, then goes back to waiting. */
    tell: (text: string) => announce(text, () => undefined, 'speaking'),

    /** Says one thing, such as that the next part is theirs, and goes back to waiting. The microphone stays on. */
    announce,

    /** Whether a conversation is in progress. */
    get busy() {
      return mode !== 'idle';
    },
  };
}

export type Conversation = ReturnType<typeof createConversation>;
