import { describe, expect, it } from 'vitest';

import { askForJson, askModel, type ModelCall } from './language-model';

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | 'throw' | 'hang';

/** A model endpoint that gives each reply in turn, and remembers what it was asked. */
function endpoint(...replies: Reply[]) {
  const asked: { url: string; model: unknown; auth: string | undefined }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { model: unknown };
    asked.push({ url, model: body.model, auth: (init.headers as Record<string, string>).Authorization });
    const reply = replies[Math.min(asked.length - 1, replies.length - 1)]!;
    if (reply === 'throw') throw new TypeError('fetch failed');
    if (reply === 'hang') {
      return new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status, headers: reply.headers ?? {} });
  }) as unknown as typeof fetch;
  return { fetchImpl, asked };
}

const answer = (content: string) => ({ status: 200, body: { choices: [{ message: { content } }] } });
/** What Moonshot sends when the account's requests-per-minute cap is reached (seen 11 November 2026). */
const capped = (seconds = 1) => ({
  status: 429,
  body: {
    error: {
      message: `Your account org-x<ak-y> request reached organization max RPM: 3, please try again after ${seconds} seconds`,
      type: 'rate_limit_reached_error',
    },
  },
});

const MESSAGES = [{ role: 'user' as const, content: 'hi' }];
const noWait = { sleep: async () => {} };

describe('asking the model', () => {
  it('hands back the JSON object it answered', async () => {
    const { fetchImpl } = endpoint(answer('```json\n{"say":"hi","actions":[]}\n```'));
    const result = await askModel(MESSAGES, { apiKey: 'k', fetch: fetchImpl });
    expect(result).toMatchObject({ ok: true, json: { say: 'hi', actions: [] }, attempts: 1, model: 'kimi-k2.6' });
  });

  it('waits out a short rate limit once and asks again', async () => {
    const waited: number[] = [];
    const { fetchImpl, asked } = endpoint(capped(1), answer('{"ok":1}'));
    const result = await askModel(MESSAGES, {
      apiKey: 'k',
      fetch: fetchImpl,
      sleep: async (ms) => void waited.push(ms),
    });
    expect(result).toMatchObject({ ok: true, json: { ok: 1 }, attempts: 2 });
    expect(asked).toHaveLength(2);
    expect(waited).toEqual([1000]);
  });

  it('takes the wait from a Retry-After header too', async () => {
    const waited: number[] = [];
    const { fetchImpl } = endpoint({ status: 429, headers: { 'retry-after': '2' } }, answer('{"ok":1}'));
    await askModel(MESSAGES, { apiKey: 'k', fetch: fetchImpl, sleep: async (ms) => void waited.push(ms) });
    expect(waited).toEqual([2000]);
  });

  it('says it is rate limited, not that it did not understand, when the limit holds', async () => {
    const { fetchImpl, asked } = endpoint(capped(1), capped(1));
    const result = await askModel(MESSAGES, { apiKey: 'k', fetch: fetchImpl, ...noWait });
    expect(result).toMatchObject({ ok: false, failure: 'rate_limited', status: 429, attempts: 2 });
    expect(asked).toHaveLength(2);
  });

  it('does not sit out a long rate limit while someone is waiting', async () => {
    const { fetchImpl, asked } = endpoint(capped(30));
    const result = await askModel(MESSAGES, { apiKey: 'k', fetch: fetchImpl, ...noWait });
    expect(result).toMatchObject({ ok: false, failure: 'rate_limited', attempts: 1 });
    expect(asked).toHaveLength(1);
  });

  it('names each other way it can fail', async () => {
    const ask = async (reply: Reply) => askModel(MESSAGES, { apiKey: 'k', fetch: endpoint(reply).fetchImpl, ...noWait });
    expect(await ask({ status: 401 })).toMatchObject({ ok: false, failure: 'refused', status: 401 });
    expect(await ask({ status: 403 })).toMatchObject({ ok: false, failure: 'refused', status: 403 });
    expect(await ask({ status: 500 })).toMatchObject({ ok: false, failure: 'unavailable', status: 500 });
    expect(await ask({ status: 503 })).toMatchObject({ ok: false, failure: 'unavailable', status: 503 });
    expect(await ask('throw')).toMatchObject({ ok: false, failure: 'unavailable' });
    expect(await ask(answer('I would rather not answer in JSON'))).toMatchObject({ ok: false, failure: 'no_json' });
    expect(await ask({ status: 200, body: { choices: [] } })).toMatchObject({ ok: false, failure: 'no_json' });
  });

  it('gives up at its deadline instead of answering a person who has stopped waiting', async () => {
    const started = Date.now();
    const result = await askModel(MESSAGES, { apiKey: 'k', fetch: endpoint('hang').fetchImpl, deadlineMs: 50 });
    expect(result).toMatchObject({ ok: false, failure: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('asks the backup model when the first cannot answer, with its own key', async () => {
    const { fetchImpl, asked } = endpoint({ status: 500 }, answer('{"ok":1}'));
    const result = await askModel(MESSAGES, {
      apiKey: 'first',
      fetch: fetchImpl,
      ...noWait,
      fallback: { apiKey: 'second', apiUrl: 'https://backup.test/v1/chat/completions', model: 'backup-1' },
    });
    expect(result).toMatchObject({ ok: true, json: { ok: 1 }, model: 'backup-1', attempts: 2 });
    expect(asked.map((a) => [a.url, a.model, a.auth])).toEqual([
      ['https://api.moonshot.ai/v1/chat/completions', 'kimi-k2.6', 'Bearer first'],
      ['https://backup.test/v1/chat/completions', 'backup-1', 'Bearer second'],
    ]);
  });

  it('does not ask the backup about an answer the first model did give', async () => {
    const { fetchImpl, asked } = endpoint(answer('no json here'));
    const result = await askModel(MESSAGES, { apiKey: 'k', fetch: fetchImpl, fallback: { apiKey: 'b', model: 'b' } });
    expect(result).toMatchObject({ ok: false, failure: 'no_json' });
    expect(asked).toHaveLength(1);
  });

  it('reports every ask once, with what happened and how long it took', async () => {
    const calls: ModelCall[] = [];
    await askModel(MESSAGES, {
      apiKey: 'k',
      fetch: endpoint(capped(1), capped(1)).fetchImpl,
      ...noWait,
      agent: 'assistant',
      onCall: (call) => void calls.push(call),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ agent: 'assistant', outcome: 'rate_limited', status: 429, attempts: 2, model: 'kimi-k2.6' });
    expect(calls[0]!.ms).toBeGreaterThanOrEqual(0);
  });

  it('a report that throws never breaks the answer', async () => {
    const result = await askModel(MESSAGES, {
      apiKey: 'k',
      fetch: endpoint(answer('{"ok":1}')).fetchImpl,
      onCall: () => {
        throw new Error('logging is down');
      },
    });
    expect(result.ok).toBe(true);
  });
});

describe('askForJson, for callers that only need the object', () => {
  it('is the object, or null for any failure', async () => {
    expect(await askForJson(MESSAGES, { apiKey: 'k', fetch: endpoint(answer('{"a":1}')).fetchImpl })).toEqual({ a: 1 });
    expect(await askForJson(MESSAGES, { apiKey: 'k', fetch: endpoint({ status: 500 }).fetchImpl })).toBeNull();
  });
});
