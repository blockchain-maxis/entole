/**
 * The language model every reader asks: the assistant's (`assistant-brain.ts`),
 * the help bot's (`help.ts`) and Telegram's (`telegram-intake.ts`). It is Kimi,
 * from Moonshot AI, through its OpenAI-compatible `chat/completions` endpoint.
 * Server side only: the key is read in the routes that call this and never
 * reaches a client bundle.
 *
 * Reading a sentence into a fixed vocabulary needs no long reasoning, so the
 * default model is asked with thinking off, which is what makes it quick
 * enough to answer someone who is talking. Any other OpenAI-compatible
 * endpoint and model can be put in its place with `apiUrl` and `model`, and a
 * second one can stand behind it with `fallback`.
 *
 * Why the failures are named. On 11 November 2026 the live assistant answered
 * "I didn't get that" to "put 20k inside savings": the account had reached its
 * cap of three requests a minute, and every failure looked the same as a
 * sentence the model could not follow. So each way an ask can fail has its own
 * name, the caller can tell "busy" from "not understood", a short rate limit
 * is waited out once, and every ask is reported to `onCall` so a person can
 * see it happening.
 */

export const KIMI_API_URL = 'https://api.moonshot.ai/v1/chat/completions';
export const KIMI_MODEL = 'kimi-k2.6';

/** The longest one ask may take, retries and backup included. The app stops waiting at 12 s. */
export const MODEL_DEADLINE_MS = 10_000;
/** A rate limit asking for a longer wait than this is not waited out: someone is talking. */
export const MODEL_RETRY_WAIT_MAX_MS = 2_000;

export type ModelEndpoint = {
  apiKey: string;
  model?: string | undefined;
  /** An OpenAI-compatible `chat/completions` endpoint. Defaults to Moonshot's. */
  apiUrl?: string | undefined;
};

/** Which reader is asking, so what each one costs and how often it fails can be told apart. */
export type ModelAgent = 'assistant' | 'help' | 'telegram' | 'eval';

export type ModelFailure =
  /** The provider's request cap was reached. */
  | 'rate_limited'
  /** No answer before the deadline. */
  | 'timeout'
  /** The provider errored, or could not be reached. */
  | 'unavailable'
  /** The key was refused. */
  | 'refused'
  /** It answered, but with no JSON object in it. */
  | 'no_json';

export type ModelCall = {
  agent: ModelAgent | undefined;
  model: string;
  outcome: 'ok' | ModelFailure;
  status: number | undefined;
  attempts: number;
  ms: number;
};

export type LanguageModelConfig = ModelEndpoint & {
  /** Asked when the first model is busy, down or refuses the key. Never asked about an answer the first one gave. */
  fallback?: ModelEndpoint | undefined;
  deadlineMs?: number | undefined;
  agent?: ModelAgent | undefined;
  /** Told about every ask once it is over. A report that throws is ignored. */
  onCall?: ((call: ModelCall) => void) | undefined;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ModelAnswer =
  | { ok: true; json: unknown; model: string; attempts: number; ms: number }
  | { ok: false; failure: ModelFailure; status: number | undefined; model: string; attempts: number; ms: number };

/** Kimi K2.6 can be asked with thinking off; K3 always thinks, and other providers do not know the field. */
function canTurnThinkingOff(model: string): boolean {
  return /^kimi-k2\.6/.test(model);
}

/** Pulls the JSON object out of a model's answer, which sometimes arrives wrapped in a code fence. */
export function jsonIn(content: string): unknown {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** How long a 429 asks to be left alone, from its header or, as Moonshot writes it, its message. */
function retryAfterMs(response: Response, body: unknown): number | null {
  const header = response.headers.get('retry-after');
  if (header !== null && /^\d+(?:\.\d+)?$/.test(header.trim())) return Number(header) * 1000;
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  const said = typeof message === 'string' ? /after (\d+(?:\.\d+)?) seconds?/i.exec(message) : null;
  return said ? Number(said[1]) * 1000 : null;
}

type Attempt =
  | { ok: true; json: unknown }
  | { ok: false; failure: ModelFailure; status: number | undefined; waitMs?: number | null };

async function attempt(
  endpoint: ModelEndpoint,
  messages: ChatMessage[],
  maxTokens: number,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Attempt> {
  const model = endpoint.model ?? KIMI_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, timeoutMs));
  try {
    const response = await fetchImpl(endpoint.apiUrl ?? KIMI_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endpoint.apiKey}` },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        max_tokens: maxTokens,
        ...(canTurnThinkingOff(model) ? { thinking: { type: 'disabled' } } : {}),
        messages,
      }),
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 429) {
      return { ok: false, failure: 'rate_limited', status: 429, waitMs: retryAfterMs(response, body) };
    }
    if (response.status === 401 || response.status === 403) return { ok: false, failure: 'refused', status: response.status };
    if (!response.ok) return { ok: false, failure: 'unavailable', status: response.status };
    const content = (body as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
    const json = typeof content === 'string' ? jsonIn(content) : null;
    return json === null ? { ok: false, failure: 'no_json', status: response.status } : { ok: true, json };
  } catch {
    return { ok: false, failure: controller.signal.aborted ? 'timeout' : 'unavailable', status: undefined };
  } finally {
    clearTimeout(timer);
  }
}

/** Failures that say nothing about the question, only about the model: worth asking the backup. */
const CAPACITY: readonly ModelFailure[] = ['rate_limited', 'timeout', 'unavailable', 'refused'];

/**
 * Asks for one JSON object, and says plainly how it went. Whatever comes back
 * is still unchecked; each caller parses it with its own schema before using
 * it. Never throws.
 */
export async function askModel(
  messages: ChatMessage[],
  config: LanguageModelConfig,
  maxTokens = 300,
): Promise<ModelAnswer> {
  const fetchImpl = config.fetch ?? fetch;
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = Date.now();
  const deadline = started + (config.deadlineMs ?? MODEL_DEADLINE_MS);
  const left = () => deadline - Date.now();

  const endpoints: ModelEndpoint[] = [config, ...(config.fallback ? [config.fallback] : [])];
  let attempts = 0;
  let last: Attempt & { ok: false } = { ok: false, failure: 'timeout', status: undefined };
  let model = config.model ?? KIMI_MODEL;

  for (const endpoint of endpoints) {
    model = endpoint.model ?? KIMI_MODEL;
    let result = await attempt(endpoint, messages, maxTokens, fetchImpl, left());
    attempts += 1;
    // A short rate limit is waited out once, if there is time to ask again after it.
    if (!result.ok && result.failure === 'rate_limited' && result.waitMs != null) {
      const wait = result.waitMs;
      if (wait <= MODEL_RETRY_WAIT_MAX_MS && left() - wait > 1_000) {
        await sleep(wait);
        result = await attempt(endpoint, messages, maxTokens, fetchImpl, left());
        attempts += 1;
      }
    }
    if (result.ok) {
      return report(config, { ok: true, json: result.json, model, attempts, ms: Date.now() - started });
    }
    last = result;
    if (!CAPACITY.includes(result.failure) || left() <= 1_000) break;
  }

  return report(config, {
    ok: false,
    failure: last.failure,
    status: last.status,
    model,
    attempts,
    ms: Date.now() - started,
  });
}

function report(config: LanguageModelConfig, answer: ModelAnswer): ModelAnswer {
  try {
    config.onCall?.({
      agent: config.agent,
      model: answer.model,
      outcome: answer.ok ? 'ok' : answer.failure,
      status: answer.ok ? 200 : answer.status,
      attempts: answer.attempts,
      ms: answer.ms,
    });
  } catch {
    // A report is never worth losing the answer over.
  }
  return answer;
}

/** The object, or `null` for any failure: for readers that fall back the same way whatever went wrong. */
export async function askForJson(
  messages: ChatMessage[],
  config: LanguageModelConfig,
  maxTokens = 300,
): Promise<unknown> {
  const answer = await askModel(messages, config, maxTokens);
  return answer.ok ? answer.json : null;
}
