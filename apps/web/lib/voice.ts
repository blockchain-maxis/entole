/**
 * Listening and speaking, with what the browser itself provides.
 *
 * Listening is the browser's speech recognition. In Chrome and on Android the
 * browser sends the sound to its maker's service to be turned into words, and
 * hands back the words; Entole never receives the sound, only the words. Not
 * every browser has it. Where it is missing the assistant is typed to, and
 * says so.
 *
 * Speaking is the browser's own voice, on the device.
 */

type RecognitionResult = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as Record<string, unknown>;
  return (scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null) as (new () => Recognition) | null;
}

export function canListen(): boolean {
  return recognitionClass() !== null;
}

export type ListenEnd = 'heard' | 'nothing' | 'not-allowed' | 'failed';

/**
 * Listens for one thing said. `onWords` is called as the words firm up, so
 * they can be shown while the person is still talking, and `onEnd` once: with
 * what was heard, or why nothing was. Returns how to stop early, or `null`
 * where the browser cannot listen.
 */
export function listen(handlers: {
  onWords: (text: string) => void;
  onEnd: (why: ListenEnd, text: string) => void;
}): { stop: () => void } | null {
  const Recogniser = recognitionClass();
  if (!Recogniser) return null;

  const recognition = new Recogniser();
  // Nigerian English first; the service falls back to its nearest where it has none.
  recognition.lang = 'en-NG';
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  let heard = '';
  let ended = false;
  const end = (why: ListenEnd) => {
    if (ended) return;
    ended = true;
    handlers.onEnd(why, heard.trim());
  };

  recognition.onresult = (event) => {
    let text = '';
    for (let index = 0; index < event.results.length; index += 1) {
      text += event.results[index]?.[0]?.transcript ?? '';
    }
    heard = text;
    handlers.onWords(text.trim());
  };
  recognition.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') end('not-allowed');
    else if (event.error === 'no-speech' || event.error === 'aborted') end(heard.trim() ? 'heard' : 'nothing');
    else end('failed');
  };
  recognition.onend = () => end(heard.trim() ? 'heard' : 'nothing');

  try {
    recognition.start();
  } catch {
    end('failed');
    return null;
  }
  return {
    stop: () => {
      try {
        recognition.stop();
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

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

/** Says a sentence, in place of whatever was being said. Silent where the browser has no voice. */
export function speak(text: string): void {
  if (!canSpeak() || !text.trim()) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speakable(text));
    utterance.lang = 'en-NG';
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Nothing is lost: the same words are on the screen.
  }
}

export function stopSpeaking(): void {
  if (!canSpeak()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Already quiet.
  }
}
