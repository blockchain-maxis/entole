/**
 * Listening and speaking on the phone.
 *
 * Both are native modules. A build made before they were added does not have
 * them. Loading a package whose native half is missing throws while the package
 * starts, and Metro reports a throw from a top-level `require` as a fatal error
 * instead of passing it to a `try` (only a nested one reaches it), which showed
 * as "Cannot find native module" on a dev build made too early. So the native
 * half is asked for first, with the call that answers `null` instead of
 * throwing, and the package is loaded only when it is there. Its absence is
 * simply "the assistant is typed to, and does not speak".
 *
 * Listening is the phone's own speech recognition, which on Android is
 * Google's. Entole never receives the sound, only the words it is handed.
 * Speaking is the phone's own voice.
 */

import { requireOptionalNativeModule } from 'expo';

import { ASSISTANT_NAME, accentFor, readWake, type Accent } from '@entole/core/assistant-persona';

type Subscription = { remove: () => void };

type RecognitionModule = {
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  start: (options: {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    requiresOnDeviceRecognition?: boolean;
    contextualStrings?: string[];
  }) => void;
  stop: () => void;
  supportsOnDeviceRecognition?: () => boolean;
  addListener: {
    (event: 'result', listener: (event: { isFinal: boolean; results: { transcript: string }[] }) => void): Subscription;
    (event: 'error', listener: (event: { error: string }) => void): Subscription;
    (event: 'end', listener: () => void): Subscription;
  };
};

type SpeechModule = {
  speak: (
    text: string,
    options?: {
      language?: string;
      rate?: number;
      onDone?: () => void;
      onStopped?: () => void;
      onError?: () => void;
    },
  ) => void;
  stop: () => Promise<void> | void;
};

/** How the assistant sounds and listens. Set from the saved choice when the app opens (see `lib/assistant-presence.tsx`). */
let accent: Accent = accentFor(null);
export function setVoiceAccent(id: string | null | undefined): void {
  accent = accentFor(id);
}

let recognition: RecognitionModule | null | undefined;
function loadRecognition(): RecognitionModule | null {
  if (recognition !== undefined) return recognition;
  if (!requireOptionalNativeModule('ExpoSpeechRecognition')) {
    recognition = null;
    return recognition;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('expo-speech-recognition') as { ExpoSpeechRecognitionModule?: RecognitionModule };
    recognition = loaded.ExpoSpeechRecognitionModule ?? null;
  } catch {
    recognition = null;
  }
  return recognition;
}

/** Puts a recogniser in place of the phone's, so the listening loops can be driven by a test. */
export function provideRecognitionForTests(module: RecognitionModule | null | undefined): void {
  recognition = module;
}

let speech: SpeechModule | null | undefined;
function loadSpeech(): SpeechModule | null {
  if (speech !== undefined) return speech;
  if (!requireOptionalNativeModule('ExpoSpeech')) {
    speech = null;
    return speech;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    speech = require('expo-speech') as SpeechModule;
  } catch {
    speech = null;
  }
  return speech;
}

/** Whether this build of the app can listen at all. */
export function canListen(): boolean {
  return loadRecognition() !== null;
}

/** Whether this build of the app can speak at all. */
export function canSpeak(): boolean {
  return loadSpeech() !== null;
}

export type ListenEnd = 'heard' | 'nothing' | 'not-allowed' | 'failed';

/**
 * Listens for one thing said. `onWords` is called as the words firm up, and
 * `onEnd` once: with what was heard, or why nothing was. Resolves to how to
 * stop early, or `null` when this build cannot listen or was not allowed to.
 */
export async function listen(handlers: {
  onWords: (text: string) => void;
  onEnd: (why: ListenEnd, text: string) => void;
}): Promise<{ stop: () => void } | null> {
  const module = loadRecognition();
  if (!module) return null;

  let allowed = false;
  try {
    allowed = (await module.requestPermissionsAsync()).granted;
  } catch {
    allowed = false;
  }
  if (!allowed) {
    handlers.onEnd('not-allowed', '');
    return null;
  }

  let heard = '';
  let ended = false;
  const subscriptions: Subscription[] = [];
  const end = (why: ListenEnd) => {
    if (ended) return;
    ended = true;
    for (const subscription of subscriptions) subscription.remove();
    handlers.onEnd(why, heard.trim());
  };

  subscriptions.push(
    module.addListener('result', (event) => {
      heard = event.results[0]?.transcript ?? heard;
      handlers.onWords(heard.trim());
    }),
    module.addListener('error', (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') end('not-allowed');
      else if (event.error === 'no-speech' || event.error === 'aborted') end(heard.trim() ? 'heard' : 'nothing');
      else end('failed');
    }),
    module.addListener('end', () => end(heard.trim() ? 'heard' : 'nothing')),
  );

  try {
    // The chosen accent first (Nigerian English to begin with); the recogniser
    // falls back to its nearest where it has none. The name is given as a hint
    // so it is not heard as some other word.
    module.start({ lang: accent.listen, interimResults: true, continuous: false, contextualStrings: [ASSISTANT_NAME] });
  } catch {
    end('failed');
    return null;
  }
  return {
    stop: () => {
      try {
        module.stop();
      } catch {
        end(heard.trim() ? 'heard' : 'nothing');
      }
    },
  };
}

/** A sentence as it should be said aloud: "₦5,000" is read as an amount of naira, not as a symbol. */
export function speakable(text: string): string {
  return text.replace(/₦\s?([\d,]+(?:\.\d+)?)/g, '$1 naira').replace(/@([a-z0-9_.]+)/gi, '$1');
}

/** Says a sentence, in place of whatever was being said. Silent on a build with no voice. */
export function speak(text: string): void {
  void speakAndWait(text);
}

/**
 * Says a sentence and resolves when it has been said (or cut off, or could not
 * be). A conversation needs this: the assistant must not start listening while
 * it is still talking, or it hears itself. A voice that never reports back is
 * waited on for no longer than the sentence could take to say.
 */
export function speakAndWait(text: string): Promise<void> {
  const module = loadSpeech();
  if (!module || !text.trim()) return Promise.resolve();
  const spoken = speakable(text);
  return new Promise<void>((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(giveUp);
      resolve();
    };
    // About 14 characters a second at an easy pace, plus slack.
    const giveUp = setTimeout(done, 1500 + (spoken.length / 14) * 1000);
    try {
      void module.stop();
      module.speak(spoken, { language: accent.speak, rate: 1, onDone: done, onStopped: done, onError: done });
    } catch {
      // Nothing is lost: the same words are on the screen.
      done();
    }
  });
}

export function stopSpeaking(): void {
  try {
    void loadSpeech()?.stop();
  } catch {
    // Already quiet.
  }
}

// ---------------------------------------------------------------------------
// Waiting to be called.
// ---------------------------------------------------------------------------

export type WakeTrouble = 'not-allowed' | 'failed';

/**
 * Listens, while the app is open, for the assistant's name ("hey Ayo").
 *
 * A phone cannot listen for one phrase on its own, so this runs the phone's
 * speech recognition continuously and looks for the name in what it writes
 * down. That has a cost the person is told about where they turn it on: while
 * it runs, the phone's speech service is listening. Where the phone can do it
 * without leaving the device it is asked to; where it cannot, it is not
 * pretended otherwise. Entole itself receives words, never sound, and nothing
 * is kept.
 *
 * It stops the moment it hears the name and hands over what was said after it
 * ("hey Ayo what's my balance" gives "what's my balance"; "hey Ayo" alone
 * gives nothing). Whoever called it then listens for the rest, and starts it
 * again when the conversation is over. Recognition sessions end by themselves
 * after a spell of quiet, so a session that ends is begun again, a few times
 * over if it keeps failing, and then it gives up and says so.
 *
 * Resolves to how to stop it, or `null` when this build cannot listen.
 */
export async function watchForWake(handlers: {
  onWake: (rest: string) => void;
  onTrouble: (why: WakeTrouble) => void;
}): Promise<{ stop: () => void } | null> {
  const module = loadRecognition();
  if (!module) return null;

  let allowed = false;
  try {
    allowed = (await module.requestPermissionsAsync()).granted;
  } catch {
    allowed = false;
  }
  if (!allowed) {
    handlers.onTrouble('not-allowed');
    return null;
  }

  let stopped = false;
  let failures = 0;
  let restart: ReturnType<typeof setTimeout> | null = null;
  let subscriptions: Subscription[] = [];

  const clear = () => {
    for (const subscription of subscriptions) subscription.remove();
    subscriptions = [];
  };
  const halt = () => {
    stopped = true;
    if (restart) clearTimeout(restart);
    clear();
    try {
      module.stop();
    } catch {
      // Already stopped.
    }
  };

  const begin = () => {
    if (stopped) return;
    clear();
    /** What came after the name, kept as the sentence firms up. `null` until the name is heard. */
    let rest: string | null = null;
    let handed = false;
    const hand = () => {
      if (handed || rest === null) return;
      handed = true;
      halt();
      handlers.onWake(rest);
    };

    subscriptions.push(
      module.addListener('result', (event) => {
        failures = 0;
        const heard = event.results[0]?.transcript ?? '';
        const wake = readWake(heard);
        if (wake.woke) {
          rest = wake.rest;
          // Nothing after the name: no point waiting for a sentence that is not coming.
          // Something after it: wait for the sentence to be finished.
          if (event.isFinal || rest === '') hand();
        }
      }),
      module.addListener('error', (event) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          halt();
          handlers.onTrouble('not-allowed');
          return;
        }
        // Quiet and aborted sessions are the ordinary way one ends.
        if (event.error !== 'no-speech' && event.error !== 'aborted') failures += 1;
      }),
      module.addListener('end', () => {
        if (rest !== null) {
          hand();
          return;
        }
        if (stopped) return;
        if (failures >= 4) {
          halt();
          handlers.onTrouble('failed');
          return;
        }
        restart = setTimeout(begin, failures > 0 ? 600 * failures : 250);
      }),
    );

    try {
      module.start({
        lang: accent.listen,
        interimResults: true,
        continuous: true,
        contextualStrings: [ASSISTANT_NAME, `Hey ${ASSISTANT_NAME}`],
        // Off the network when the phone can manage it.
        ...(module.supportsOnDeviceRecognition?.() ? { requiresOnDeviceRecognition: true } : {}),
      });
    } catch {
      failures += 1;
      restart = setTimeout(begin, 600 * failures);
    }
  };

  begin();
  return { stop: halt };
}
