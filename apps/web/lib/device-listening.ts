/**
 * Listening on the device itself, for the browsers that cannot listen on
 * their own: Firefox, Brave, the iPhone home-screen app, and the browsers
 * inside other apps.
 *
 * The microphone is recorded here, the recording is turned into words by a
 * small speech model running in a worker (`whisper.worker.ts`), and only the
 * words go on to the assistant. The model is downloaded once, after the person
 * has said yes to it, and kept by the browser.
 *
 * Nothing here is used where the browser's own listening works (`voice.ts`).
 */

/** What the first download comes to, said before anyone agrees to it. */
export const DEVICE_LISTENING_MEGABYTES = 65;

const READY_KEY = 'entole.voice.on-device';
const PREFER_KEY = 'entole.voice.way';

/** Above this the microphone is taken to be hearing speech, not the room. */
const SPEECH_LEVEL = 0.025;
/** Quiet for this long after speaking ends the recording. */
const SILENCE_MS = 1100;
/** Nothing said in this long ends it with nothing heard. */
const WAIT_MS = 6000;
/** A request is a sentence; nobody needs longer than this. */
const LONGEST_MS = 9000;
const SAMPLE_RATE = 16_000;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Remembering is a convenience; without it the question is asked again.
  }
}

export function canRecord(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof window.MediaRecorder === 'function' &&
    typeof window.OfflineAudioContext === 'function' &&
    typeof Worker === 'function'
  );
}

/** Whether the model has been fetched on this browser before. */
export function deviceListeningReady(): boolean {
  return typeof window !== 'undefined' && read(READY_KEY) === 'ready';
}

/**
 * Browsers that offer listening and do not deliver it. Brave has the
 * browser's listening switched off behind the same name; the iPhone
 * home-screen app has it and loses it once installed. Either way the device
 * model is the one that works.
 */
export function prefersDeviceListening(): boolean {
  if (typeof window === 'undefined') return false;
  if (read(PREFER_KEY) === 'device') return true;
  const nav = navigator as Navigator & { brave?: unknown; standalone?: boolean };
  return Boolean(nav.brave) || nav.standalone === true;
}

/** Called when the browser's own listening has failed here, so it is not offered again. */
export function preferDeviceListening(): void {
  write(PREFER_KEY, 'device');
}

// ---------------------------------------------------------------------------
// The worker.
// ---------------------------------------------------------------------------

type Outbound =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'heard'; id: number; text: string }
  | { type: 'failed'; id?: number; reason: string };

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void }>();
let loading: Promise<void> | null = null;
let onProgress: ((fraction: number) => void) | null = null;
let shown = 0;

function theWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<Outbound>) => {
    const message = event.data;
    if (message.type === 'progress') {
      // Never backwards: a file that starts late must not make the meter fall.
      const fraction = message.total > 0 ? Math.min(1, message.loaded / message.total) : 0;
      shown = Math.max(shown, fraction);
      onProgress?.(shown);
    } else if (message.type === 'heard') {
      waiting.get(message.id)?.resolve(message.text);
      waiting.delete(message.id);
    } else if (message.type === 'failed' && message.id !== undefined) {
      waiting.get(message.id)?.reject(new Error(message.reason));
      waiting.delete(message.id);
    }
  };
  return worker;
}

/**
 * Fetches the model (or finds it already kept) and has it ready. `progress`
 * is told how much of the download has arrived, from 0 to 1.
 */
export function prepareDeviceListening(progress?: (fraction: number) => void): Promise<void> {
  onProgress = progress ?? null;
  if (loading) return loading;
  const target = theWorker();
  loading = new Promise<void>((resolve, reject) => {
    const listener = (event: MessageEvent<Outbound>) => {
      if (event.data.type === 'ready') {
        target.removeEventListener('message', listener);
        write(READY_KEY, 'ready');
        resolve();
      } else if (event.data.type === 'failed' && event.data.id === undefined) {
        target.removeEventListener('message', listener);
        loading = null;
        reject(new Error('load'));
      }
    };
    target.addEventListener('message', listener);
    target.postMessage({ type: 'load' });
  });
  return loading;
}

function transcribe(audio: Float32Array): Promise<string> {
  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    theWorker().postMessage({ type: 'hear', id, audio }, [audio.buffer]);
  });
}

// ---------------------------------------------------------------------------
// The microphone.
// ---------------------------------------------------------------------------

export type DeviceListenEnd = 'heard' | 'nothing' | 'not-allowed' | 'no-microphone' | 'failed';

type AudioContextClass = typeof AudioContext;

function audioContextClass(): AudioContextClass | null {
  const scope = window as unknown as { AudioContext?: AudioContextClass; webkitAudioContext?: AudioContextClass };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/** Any recording the browser made, as 16 kHz mono samples, which is what the model reads. */
async function toModelAudio(recording: Blob): Promise<Float32Array> {
  const Context = audioContextClass();
  if (!Context) throw new Error('no-audio');
  const context = new Context();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    const length = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, length, SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return new Float32Array(rendered.getChannelData(0));
  } finally {
    void context.close().catch(() => undefined);
  }
}

/**
 * Records one thing said and turns it into words. It stops by itself after a
 * moment of quiet, or when `stop` is called. `onWriting` is called when the
 * recording is done and the words are being worked out; `onEnd` once, with
 * the words or why there are none.
 */
export function listenOnDevice(handlers: {
  onWriting: () => void;
  onEnd: (why: DeviceListenEnd, text: string) => void;
}): { stop: () => void } {
  let ended = false;
  let stopRequested = false;
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let meter: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  let heardSpeech = false;

  const release = () => {
    if (timer) clearInterval(timer);
    if (deadline) clearTimeout(deadline);
    timer = null;
    deadline = null;
    stream?.getTracks().forEach((track) => track.stop());
    void meter?.close().catch(() => undefined);
    meter = null;
  };

  const end = (why: DeviceListenEnd, text = '') => {
    if (ended) return;
    ended = true;
    release();
    handlers.onEnd(why, text);
  };

  const finish = () => {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    else if (!recorder) end('nothing');
  };

  void (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      const name = (error as { name?: string })?.name;
      end(name === 'NotFoundError' || name === 'OverconstrainedError' ? 'no-microphone' : name === 'NotAllowedError' || name === 'SecurityError' ? 'not-allowed' : 'failed');
      return;
    }
    if (stopRequested || ended) {
      stream.getTracks().forEach((track) => track.stop());
      end('nothing');
      return;
    }

    const chunks: Blob[] = [];
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      end('failed');
      return;
    }
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = async () => {
      release();
      if (ended) return;
      if (!heardSpeech || chunks.length === 0) {
        end('nothing');
        return;
      }
      handlers.onWriting();
      try {
        const audio = await toModelAudio(new Blob(chunks, { type: recorder?.mimeType || chunks[0]?.type }));
        const text = await transcribe(audio);
        end(text ? 'heard' : 'nothing', text);
      } catch {
        end('failed');
      }
    };

    // How loud the room is, to tell speaking from quiet.
    const Context = audioContextClass();
    const started = Date.now();
    let lastLoud = 0;
    if (Context) {
      meter = new Context();
      const analyser = meter.createAnalyser();
      analyser.fftSize = 1024;
      meter.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        const level = Math.sqrt(sum / samples.length);
        const now = Date.now();
        if (level > SPEECH_LEVEL) {
          heardSpeech = true;
          lastLoud = now;
        }
        if (
          (heardSpeech && now - lastLoud > SILENCE_MS) ||
          (!heardSpeech && now - started > WAIT_MS) ||
          now - started > LONGEST_MS
        ) {
          finish();
        }
      }, 100);
    } else {
      // No way to measure the room: take whatever is said, up to the longest.
      heardSpeech = true;
      deadline = setTimeout(finish, LONGEST_MS);
    }
    recorder.start();
  })();

  return {
    stop: () => {
      stopRequested = true;
      // Stopping by hand keeps what was recorded, loud or not: the person knows they spoke.
      if (recorder && recorder.state !== 'inactive') heardSpeech = true;
      finish();
    },
  };
}
