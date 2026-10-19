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

import { ASSISTANT_NAME, accentFor, type Accent } from '@entole/core/assistant-persona';
import { sayNigerianNames } from '@entole/core/nigerian-names';

type Subscription = { remove: () => void };

type RecognitionModule = {
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  start: (options: {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    requiresOnDeviceRecognition?: boolean;
    contextualStrings?: string[];
    androidIntentOptions?: Record<string, string | number | boolean>;
  }) => void;
  stop: () => void;
  supportsOnDeviceRecognition?: () => boolean;
  addListener: {
    (event: 'result', listener: (event: { isFinal: boolean; results: { transcript: string }[] }) => void): Subscription;
    (event: 'error', listener: (event: { error: string }) => void): Subscription;
    (event: 'end', listener: () => void): Subscription;
  };
};

type InstalledVoice = { identifier: string; language: string; quality?: string };

type SpeechModule = {
  getAvailableVoicesAsync?: () => Promise<InstalledVoice[]>;
  speak: (
    text: string,
    options?: {
      language?: string;
      voice?: string;
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
let chosenVoice: Promise<{ id?: string; nigerian: boolean }> | null = null;
export function setVoiceAccent(id: string | null | undefined): void {
  accent = accentFor(id);
  chosenVoice = null;
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

/**
 * Asks the phone's recogniser to wait longer in silence before it decides a
 * sentence is over. Its default is about a second, which cut people off. The
 * recogniser may ignore it, so the conversation also decides for itself when
 * someone has finished (`endpointDelay` in `@entole/core/assistant-talk-flow`).
 */
const LET_ME_FINISH = {
  EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 3000,
  EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 2500,
} as const;

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
    module.start({
      lang: accent.listen,
      interimResults: true,
      continuous: false,
      contextualStrings: [ASSISTANT_NAME],
      androidIntentOptions: LET_ME_FINISH,
    });
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

/**
 * A sentence as it should be said aloud: "₦5,000" is read as an amount of naira,
 * not as a symbol. Names are respelled for the voice (`@entole/core/nigerian-names`)
 * unless the voice is itself a Nigerian one, which knows them better than a
 * respelling does; the assistant's own name is always said the way it is said.
 */
export function speakable(text: string, options: { nigerianVoice?: boolean } = {}): string {
  const said = text
    .replace(/₦\s?([\d,]+(?:\.\d+)?)/g, '$1 naira')
    .replace(/@([a-z0-9_.]+)/gi, '$1');
  // A voice reading English says "Ayo" as "AY-oh" and "Chukwuemeka" as it is spelled. The words on screen are untouched.
  return options.nigerianVoice ? said.replace(/\bayo\b/gi, 'Eye-yo') : sayNigerianNames(said);
}

const sameLanguage = (language: string, wanted: string) => language.toLowerCase().replace('_', '-').startsWith(wanted.toLowerCase().replace('_', '-'));

/**
 * The voice to speak with: a Nigerian English one if the phone has it (the best of
 * them), otherwise the phone's default for the language. Looked up once.
 */
function chooseVoice(module: SpeechModule): Promise<{ id?: string; nigerian: boolean }> {
  chosenVoice ??= (async () => {
    try {
      const voices = (await module.getAvailableVoicesAsync?.()) ?? [];
      const ours = voices.filter((voice) => sameLanguage(voice.language, accent.speak));
      const best = ours.find((voice) => voice.quality === 'Enhanced') ?? ours.find((voice) => !/local|compact|lite/i.test(voice.identifier)) ?? ours[0];
      return best ? { id: best.identifier, nigerian: /[-_]ng$/i.test(best.language) } : { nigerian: false };
    } catch {
      return { nigerian: false };
    }
  })();
  return chosenVoice;
}

/** Says a sentence, in place of whatever was being said. Silent on a build with no voice. */
export function speak(text: string): void {
  void speakAndWait(text);
}

/** How long the speaker keeps playing after the voice reports it has finished. */
const SPEAKER_DRAIN_MS = 250;

/**
 * Says a sentence and resolves when it has been said (or cut off, or could not
 * be). A conversation needs this: the assistant must not start listening while
 * it is still talking, or it hears itself. A voice that never reports back is
 * waited on for no longer than the sentence could take to say.
 */
export async function speakAndWait(text: string): Promise<void> {
  const module = loadSpeech();
  if (!module || !text.trim()) return;
  const voice = await chooseVoice(module);
  const spoken = speakable(text, { nigerianVoice: voice.nigerian });
  return new Promise<void>((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(giveUp);
      // The voice says it is done when it has handed over its last sound; the speaker is still playing it.
      setTimeout(resolve, SPEAKER_DRAIN_MS);
    };
    // About 14 characters a second at an easy pace, plus slack.
    const giveUp = setTimeout(done, 1500 + (spoken.length / 14) * 1000);
    try {
      void module.stop();
      module.speak(spoken, {
        language: accent.speak,
        ...(voice.id ? { voice: voice.id } : {}),
        rate: 1,
        onDone: done,
        onStopped: done,
        onError: done,
      });
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
// Ears: one microphone session that stays open.
// ---------------------------------------------------------------------------

/** Failures in a row before the microphone gives up and says so, and the longest wait between tries. About a minute of trying. */
const GIVE_UP_AFTER = 20;
const MAX_RETRY_MS = 3000;

export type EarsTrouble = 'not-allowed' | 'failed';

export type Ears = {
  /** Closes the microphone session for good. */
  stop: () => void;
  /** Forgets everything heard so far, so the next words start a clean buffer. */
  clear: () => void;
};

/**
 * Keeps the phone's speech recognition open and reports everything it hears as
 * one running piece of text (`onText`), until `clear()` empties it. It does not
 * decide what the words mean or when a sentence is over: that is the
 * conversation's job (`lib/conversation.ts`). Its job is to be a microphone
 * that does not blink.
 *
 * Why one session instead of one per turn: every start and stop of the phone's
 * recogniser is a visible, sometimes audible, event, and a gap in which the
 * person is not heard. Here it is opened once and kept open, including while
 * the assistant is speaking, so the person can be heard talking over it.
 *
 * What the phone does underneath, and what is done about it:
 * - It breaks speech into segments, finishing one when it hears a pause, then
 *   starting another. Segments are joined, so a pause in the middle of a
 *   sentence loses nothing.
 * - Partial results repeat the segment so far. After `clear()` the part already
 *   seen is remembered and cut off, so words are not heard twice.
 * - A session ends by itself after a long quiet or an error. It is begun again
 *   straight away, with nothing reported, and gives up only after it has failed
 *   several times running.
 * - On Android 13 and later, continuous mode also silences the start-and-stop
 *   beep. On older Androids continuous mode does not exist, so a session lasts
 *   one utterance and the beep returns: the only difference there.
 * - It asks to keep the sound on the device where the phone can; if that
 *   language is not installed on the phone, it carries on without.
 *
 * Resolves to the handle, or `null` when this build cannot listen or the
 * microphone is not allowed (then `onTrouble` says so).
 */
export async function openEars(handlers: {
  onText: (text: string) => void;
  onTrouble: (why: EarsTrouble) => void;
  /** Names and words to lean towards (the person's saved people and common Nigerian names). The assistant's own name is always among them. */
  vocabulary?: readonly string[];
}): Promise<Ears | null> {
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
  let onDevice = module.supportsOnDeviceRecognition?.() === true;
  let restart: ReturnType<typeof setTimeout> | null = null;
  let subscriptions: Subscription[] = [];

  /** Whole segments the phone has finished with since the last `clear()`. */
  let committed: string[] = [];
  /** The segment in progress, as the phone last wrote it, and without any part already cleared. */
  let current = '';
  let rawCurrent = '';
  /** The part of the segment in progress that was there when `clear()` was called. */
  let baseline = '';

  const emit = () => handlers.onText([...committed, current].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim());

  const withoutBaseline = (text: string) => {
    if (baseline && text.toLowerCase().startsWith(baseline.toLowerCase())) return text.slice(baseline.length).trim();
    baseline = '';
    return text;
  };

  const release = () => {
    for (const subscription of subscriptions) subscription.remove();
    subscriptions = [];
  };

  const begin = () => {
    if (stopped) return;
    release();
    current = '';
    rawCurrent = '';
    baseline = '';

    subscriptions.push(
      module.addListener('result', (event) => {
        failures = 0;
        const written = event.results[0]?.transcript ?? '';
        if (event.isFinal) {
          const fresh = withoutBaseline(written);
          if (fresh) committed.push(fresh);
          current = '';
          rawCurrent = '';
          baseline = '';
        } else {
          rawCurrent = written;
          current = withoutBaseline(written);
        }
        emit();
      }),
      module.addListener('error', (event) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          if (onDevice && event.error === 'service-not-allowed') {
            onDevice = false;
            return;
          }
          stopped = true;
          release();
          handlers.onTrouble('not-allowed');
          return;
        }
        if (event.error === 'language-not-supported' && onDevice) {
          // The language is not installed on the phone: use the network instead.
          onDevice = false;
          return;
        }
        // Quiet and aborted sessions are the ordinary way one ends.
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          failures += 1;
          if (typeof __DEV__ !== 'undefined' && __DEV__) console.log(`[ears] error ${event.error} (${failures} in a row)`);
          // A dropped connection: the phone's own recogniser can carry on without one, where it has the language.
          if (event.error === 'network' && !onDevice && module.supportsOnDeviceRecognition?.() === true) onDevice = true;
        }
      }),
      module.addListener('end', () => {
        if (stopped) return;
        if (failures >= GIVE_UP_AFTER) {
          stopped = true;
          release();
          handlers.onTrouble('failed');
          return;
        }
        // Straight back on: nobody should be able to tell it ended. A session that keeps failing is
        // retried more slowly, but it keeps being retried: a dropped connection comes back.
        restart = setTimeout(begin, failures > 0 ? Math.min(500 * failures, MAX_RETRY_MS) : 40);
      }),
    );

    if (typeof __DEV__ !== 'undefined' && __DEV__) console.log(`[ears] listening in ${accent.listen}, ${onDevice ? 'on the phone' : 'over the network'}`);
    try {
      module.start({
        lang: accent.listen,
        interimResults: true,
        continuous: true,
        contextualStrings: [...new Set([ASSISTANT_NAME, `Hey ${ASSISTANT_NAME}`, 'Iyo', 'Hey Iyo', ...(handlers.vocabulary ?? [])])],
        androidIntentOptions: LET_ME_FINISH,
        ...(onDevice ? { requiresOnDeviceRecognition: true } : {}),
      });
    } catch {
      failures += 1;
      restart = setTimeout(begin, Math.min(500 * failures, MAX_RETRY_MS));
    }
  };

  begin();
  return {
    stop: () => {
      stopped = true;
      if (restart) clearTimeout(restart);
      release();
      try {
        module.stop();
      } catch {
        // Already stopped.
      }
    },
    clear: () => {
      committed = [];
      baseline = rawCurrent;
      current = '';
      emit();
    },
  };
}
