/**
 * Turning a short recording into words, on the device, in a worker so the page
 * keeps moving while it works.
 *
 * The model is Whisper (tiny, English), run by the browser through
 * transformers.js. Nothing of it is in the app's own bundle: the library, at
 * one pinned version, comes from jsDelivr, its runtime from the same place,
 * and the model's files from Hugging Face, all the first time only and kept
 * by the browser after that. The person agrees to that download before this
 * worker is ever started.
 *
 * The sound never leaves the device: it goes from the microphone to this
 * worker and nowhere else, and only the words it becomes are passed on. What
 * runs in here has no access to the page, the account or its keys; the most
 * a wrong answer from it can do is put the wrong words in the box, and words
 * only ever get a payment ready for the person to confirm.
 *
 * Messages in:  { type: 'load' } | { type: 'hear', id, audio: Float32Array (16 kHz mono) }
 * Messages out: { type: 'progress', loaded, total } | { type: 'ready' }
 *               | { type: 'heard', id, text } | { type: 'failed', id?, reason }
 */

const LIBRARY = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
const WHISPER_MODEL = 'onnx-community/whisper-tiny.en';
/**
 * What the model's files come to (the q8 encoder and decoder and their small
 * companions). The files are announced one at a time, so measuring against
 * only those seen so far would show a small file as the whole download done.
 */
const MODEL_BYTES = 41_500_000;
/** A dropped connection is tried again. Each file that finished is kept, so a retry carries on. */
const LOAD_ATTEMPTS = 3;

type Transcript = { text: string } | { text: string }[];
type Recogniser = (audio: Float32Array) => Promise<Transcript>;
type Library = {
  env: { allowLocalModels: boolean };
  pipeline: (
    task: 'automatic-speech-recognition',
    model: string,
    options: { dtype: string; device: string; progress_callback: (event: ProgressEvent) => void },
  ) => Promise<Recogniser>;
};
type ProgressEvent = { status?: string; file?: string; loaded?: number; total?: number };
type Inbound = { type: 'load' } | { type: 'hear'; id: number; audio: Float32Array };

/** The worker's own global, typed for the two things used from it. */
const scope = self as unknown as {
  postMessage: (message: unknown) => void;
  onmessage: ((event: MessageEvent<Inbound>) => void) | null;
};

/** Bytes per file, as the download reports them, so one meter covers every file. */
const files = new Map<string, { loaded: number; total: number }>();

function reportProgress(event: ProgressEvent) {
  if (event.status !== 'progress' || !event.file || !event.total) return;
  files.set(event.file, { loaded: event.loaded ?? 0, total: event.total });
  let loaded = 0;
  let total = 0;
  for (const file of files.values()) {
    loaded += file.loaded;
    total += file.total;
  }
  scope.postMessage({ type: 'progress', loaded, total: Math.max(total, MODEL_BYTES) });
}

let recogniser: Promise<Recogniser> | null = null;

async function loadOnce(): Promise<Recogniser> {
  const library = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ LIBRARY)) as Library;
  // Only ever from the model's home; nothing is looked for on this site.
  library.env.allowLocalModels = false;
  return library.pipeline('automatic-speech-recognition', WHISPER_MODEL, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: reportProgress,
  });
}

function load(): Promise<Recogniser> {
  recogniser ??= (async () => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await loadOnce();
      } catch (error) {
        if (attempt >= LOAD_ATTEMPTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }
  })();
  // A failed download is not kept: the next try starts again.
  recogniser.catch(() => {
    recogniser = null;
  });
  return recogniser;
}

/**
 * Whisper writes what it hears around speech as well as the speech:
 * "[BLANK_AUDIO]", "(music)", "[Silence]". None of that is something said.
 */
function cleanTranscript(text: string): string {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

scope.onmessage = async (event: MessageEvent<Inbound>) => {
  const message = event.data;
  if (message.type === 'load') {
    try {
      await load();
      scope.postMessage({ type: 'ready' });
    } catch {
      scope.postMessage({ type: 'failed', reason: 'load' });
    }
    return;
  }

  try {
    const hear = await load();
    const output = await hear(message.audio);
    const text = Array.isArray(output) ? output.map((part) => part.text).join(' ') : output.text;
    scope.postMessage({ type: 'heard', id: message.id, text: cleanTranscript(text ?? '') });
  } catch {
    scope.postMessage({ type: 'failed', id: message.id, reason: 'hear' });
  }
};

export {};
