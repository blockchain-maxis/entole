import * as Haptics from 'expo-haptics';

import type { TurnHistory } from '@entole/core/assistant-brain';

import { createConversation, type Outcome, type Phase } from './conversation';
import type { RunOptions } from './assistant-run';
import { connectOffers } from './voice-offers';
import { openEars, speakAndWait, stopSpeaking, type Ears, type EarsTrouble } from './voice';

/**
 * The one assistant of the app: its microphone, its conversation, and what it
 * needs from the screen.
 *
 * There is one of these for the whole app, outside React, because it has to
 * outlive every screen: the microphone is opened once and kept, and a
 * conversation carries on as the person is taken from screen to screen. React
 * gives it things to show with (`bind`) and the runner that carries out a
 * request (`setRunner`); it gives React nothing but the phase, the words and
 * the state of the microphone.
 *
 * It holds no way to confirm a payment and none to answer the fingerprint
 * prompt: the runner it is handed is the typed assistant's, which has neither.
 */

/** What the engine reports to the screen. */
export type Sinks = {
  setPhase: (phase: Phase) => void;
  setCaption: (caption: string) => void;
  /** The microphone was opened or closed. */
  setEarsOpen: (open: boolean) => void;
  /** The microphone could not be used, or stopped working. */
  onTrouble: (why: EarsTrouble) => void;
  /** Everything the microphone is hearing, while someone is watching (the assistant's settings). */
  setHeard: (text: string) => void;
};

const nowhere: Sinks = {
  setPhase: () => undefined,
  setCaption: () => undefined,
  setEarsOpen: () => undefined,
  onTrouble: () => undefined,
  setHeard: () => undefined,
};

export function createPresenceEngine() {
  let sinks: Sinks = nowhere;
  let run: (text: string, history: TurnHistory, options?: RunOptions) => Promise<Outcome> = async () => ({
    said: '',
    moved: false,
    prepared: false,
  });
  let waiting = false;
  let interruptible = true;
  let watching = 0;
  let lastLogged = '';
  let greeted = false;
  let ears: Ears | null = null;
  let opening: Promise<boolean> | null = null;

  function closeEars() {
    ears?.stop();
    ears = null;
    opening = null;
    sinks.setEarsOpen(false);
  }

  function ensureEars(): Promise<boolean> {
    if (ears) return Promise.resolve(true);
    opening ??= openEars({
      onText: (text) => {
        if (watching > 0) sinks.setHeard(text);
        if (__DEV__ && text && text !== lastLogged) {
          lastLogged = text;
          console.log(`[ears] ${text}`);
        }
        conversation.hear(text);
      },
      onTrouble: (why) => {
        ears = null;
        opening = null;
        sinks.setEarsOpen(false);
        sinks.setPhase('off');
        sinks.onTrouble(why);
      },
    }).then((opened) => {
      ears = opened;
      sinks.setEarsOpen(opened !== null);
      if (!opened) opening = null;
      return opened !== null;
    });
    return opening;
  }

  const conversation = createConversation({
    // Said aloud, so a payment's review opens by itself and is read out.
    run: (text, history) => run(text, history, { byVoice: true }),
    speak: speakAndWait,
    stopSpeaking,
    clearEars: () => ears?.clear(),
    needEars: ensureEars,
    // Waiting for the name keeps the microphone; a conversation begun by a tap gives it back.
    doneWithEars: () => {
      if (!waiting) closeEars();
    },
    setPhase: (phase) => sinks.setPhase(phase),
    setCaption: (caption) => sinks.setCaption(caption),
    nudge: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
    canInterrupt: () => interruptible,
    now: Date.now,
  });

  // Screens ask questions through this while the assistant is on, and only then.
  let enabled = false;
  connectOffers({
    offer: (asked) => enabled && void conversation.offer(asked),
    say: (text) => enabled && void conversation.tell(text),
    withdraw: (asked) => conversation.withdraw(asked),
  });

  return {
    conversation,
    ensureEars,
    /** Says a line the first time it is asked in this run of the app, and not again: the greeting on opening. */
    greetOnce(text: string) {
      if (greeted) return;
      greeted = true;
      void conversation.tell(text);
    },
    /** Whether the assistant is on at all: talking, signed in, the app in front. */
    setEnabled(on: boolean) {
      enabled = on;
    },
    closeEars,
    /** Where to show things. */
    bind(next: Sinks) {
      sinks = next;
    },
    /** What carries out a request. */
    setRunner(next: typeof run) {
      run = next;
    },
    /** Whether the person may talk over the assistant. */
    setInterruptible(on: boolean) {
      interruptible = on;
    },
    /** Someone is looking at what the microphone hears; counted, so two screens do not cancel each other. */
    watch(on: boolean) {
      watching = Math.max(0, watching + (on ? 1 : -1));
      if (watching === 0) sinks.setHeard('');
    },
    /** Whether the microphone is kept open, waiting for the name. */
    setWaiting(on: boolean) {
      waiting = on;
    },
    /** Everything away: nothing listening, nothing said. */
    shutDown() {
      conversation.dismiss();
      closeEars();
    },
  };
}

export const presence = createPresenceEngine();
