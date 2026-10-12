/**
 * Listening and speaking on the phone.
 *
 * Both are native modules. A build made before they were added does not have
 * them, and loading one there throws, so each is loaded inside a `try` and its
 * absence is simply "the assistant is typed to, and does not speak" (the same
 * pattern as the camera in `app/send/scan.tsx`).
 *
 * Listening is the phone's own speech recognition, which on Android is
 * Google's. Entole never receives the sound, only the words it is handed.
 * Speaking is the phone's own voice.
 */

type Subscription = { remove: () => void };

type RecognitionModule = {
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  start: (options: { lang: string; interimResults: boolean; continuous: boolean }) => void;
  stop: () => void;
  addListener: {
    (event: 'result', listener: (event: { isFinal: boolean; results: { transcript: string }[] }) => void): Subscription;
    (event: 'error', listener: (event: { error: string }) => void): Subscription;
    (event: 'end', listener: () => void): Subscription;
  };
};

type SpeechModule = {
  speak: (text: string, options?: { language?: string; rate?: number }) => void;
  stop: () => Promise<void> | void;
};

let recognition: RecognitionModule | null | undefined;
function loadRecognition(): RecognitionModule | null {
  if (recognition !== undefined) return recognition;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('expo-speech-recognition') as { ExpoSpeechRecognitionModule?: RecognitionModule };
    recognition = loaded.ExpoSpeechRecognitionModule ?? null;
  } catch {
    recognition = null;
  }
  return recognition;
}

let speech: SpeechModule | null | undefined;
function loadSpeech(): SpeechModule | null {
  if (speech !== undefined) return speech;
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
    // Nigerian English first; the recogniser falls back to its nearest where it has none.
    module.start({ lang: 'en-NG', interimResults: true, continuous: false });
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
  const module = loadSpeech();
  if (!module || !text.trim()) return;
  try {
    void module.stop();
    module.speak(speakable(text), { language: 'en-NG', rate: 1 });
  } catch {
    // Nothing is lost: the same words are on the screen.
  }
}

export function stopSpeaking(): void {
  try {
    void loadSpeech()?.stop();
  } catch {
    // Already quiet.
  }
}
