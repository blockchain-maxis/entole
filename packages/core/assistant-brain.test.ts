import { describe, expect, it } from 'vitest';

import {
  ASSISTANT_SYSTEM_PROMPT,
  buildTurnMessage,
  createAssistantBrain,
  readWithModel,
} from './assistant-brain';

const ME = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01' as const;

/** A model that answers with `content`, and remembers what it was sent. */
function model(content: unknown, status = 200) {
  const sent: { url: string; body: Record<string, unknown>; auth: string | undefined }[] = [];
  const fetchImpl = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
    sent.push({ url, body: JSON.parse(init.body) as Record<string, unknown>, auth: init.headers.Authorization });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, sent };
}

describe('what the model is told', () => {
  it('lists the vocabulary, and that it can never confirm or state a figure', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('"do":"pay"');
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('"do":"tell"');
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/You cannot confirm, approve or send a payment/);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/never answer with figures of your own/);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/Never say money has been sent/);
  });

  it('is sent the words, the screen and the last turns, and nothing about the account', async () => {
    const { fetchImpl, sent } = model('{"say":"","actions":[{"do":"open","screen":"receive"}]}');
    await readWithModel(
      'abeg show me how dem go pay me',
      { apiKey: 'k', fetch: fetchImpl },
      { screen: 'home', history: [{ from: 'you', text: 'hello' }, { from: 'assistant', text: 'What do you need?' }] },
    );
    const messages = sent[0]!.body.messages as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(['system', 'system', 'user', 'assistant', 'user']);
    expect(messages.at(-1)!.content).toBe('abeg show me how dem go pay me');
    expect(sent[0]!.auth).toBe('Bearer k');
    // No balance, no names, no history of payments ever leaves with the request.
    expect(JSON.stringify(sent[0]!.body)).not.toMatch(/balance(Minor)?"|contacts|allowances"|0x[0-9a-f]{40}/i);
  });
});

describe('which model is asked', () => {
  it('is Kimi by default, asked for JSON with thinking off', async () => {
    const { fetchImpl, sent } = model('{"say":"","actions":[{"do":"open","screen":"receive"}]}');
    await readWithModel('show me how to get paid', { apiKey: 'k', fetch: fetchImpl });
    expect(sent[0]!.url).toBe('https://api.moonshot.ai/v1/chat/completions');
    expect(sent[0]!.body).toMatchObject({
      model: 'kimi-k2.6',
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
    });
    expect(sent[0]!.body).not.toHaveProperty('temperature');
  });

  it('takes another endpoint and model, and sends no thinking switch a model may not know', async () => {
    const { fetchImpl, sent } = model('{"say":"","actions":[]}');
    await readWithModel('hello', { apiKey: 'k', fetch: fetchImpl, apiUrl: 'https://example.test/v1/chat/completions', model: 'kimi-k3' });
    expect(sent[0]!.url).toBe('https://example.test/v1/chat/completions');
    expect(sent[0]!.body.model).toBe('kimi-k3');
    expect(sent[0]!.body).not.toHaveProperty('thinking');
  });
});

describe('what the model may answer', () => {
  it('a reply in the vocabulary is taken', async () => {
    const { fetchImpl } = model('{"say":"Getting it ready.","actions":[{"do":"pay","to":"Tunde","amount":2000,"note":"fuel"}]}');
    expect(await readWithModel('abeg send Tunde 2k for fuel', { apiKey: 'k', fetch: fetchImpl })).toEqual({
      say: 'Getting it ready.',
      actions: [{ do: 'pay', to: 'Tunde', amount: 2000, note: 'fuel' }],
    });
  });

  it('reads a reply wrapped in a code fence', async () => {
    const { fetchImpl } = model('```json\n{"say":"","actions":[{"do":"tell","about":"balance"}]}\n```');
    expect(await readWithModel('wetin be my balance', { apiKey: 'k', fetch: fetchImpl })).toEqual({
      actions: [{ do: 'tell', about: 'balance' }],
    });
  });

  it.each([
    ['an action it made up', '{"say":"Done.","actions":[{"do":"confirm"}]}'],
    ['a screen that does not exist', '{"actions":[{"do":"open","screen":"admin"}]}'],
    ['a negative amount', '{"actions":[{"do":"pay","to":"Ada","amount":-5}]}'],
    ['too many actions', `{"actions":[${Array(4).fill('{"do":"pause"}').join(',')}]}`],
    ['prose instead of JSON', 'Sure, I sent the money.'],
    ['nothing at all', ''],
  ])('%s is thrown away whole', async (_what, content) => {
    const { fetchImpl } = model(content);
    expect(await readWithModel('do something', { apiKey: 'k', fetch: fetchImpl })).toBeNull();
  });

  it('a sentence with a word the product never uses is dropped, the action kept', async () => {
    const { fetchImpl } = model('{"say":"Opening your wallet.","actions":[{"do":"open","screen":"home"}]}');
    expect(await readWithModel('go home', { apiKey: 'k', fetch: fetchImpl })).toEqual({
      actions: [{ do: 'open', screen: 'home' }],
    });
  });

  it('a model that is down, or errors, is no answer rather than a wrong one', async () => {
    expect(await readWithModel('hi', { apiKey: 'k', fetch: model('{}', 500).fetchImpl })).toBeNull();
    const thrown = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await readWithModel('hi', { apiKey: 'k', fetch: thrown })).toBeNull();
    expect(await readWithModel('   ', { apiKey: 'k', fetch: model('{}').fetchImpl })).toBeNull();
  });
});

describe('the reader on the device', () => {
  function brain(respond: () => Response | Promise<Response>) {
    const calls: Record<string, unknown>[] = [];
    const signed: string[] = [];
    const reader = createAssistantBrain({
      baseUrl: 'https://entole.test',
      account: ME,
      sign: async (message) => {
        signed.push(message);
        return '0xabc';
      },
      fetch: (async (_url: string, init: { body: string }) => {
        calls.push(JSON.parse(init.body) as Record<string, unknown>);
        return respond();
      }) as unknown as typeof fetch,
    });
    return { reader, calls, signed };
  }

  it('answers a plain sentence itself, at once, without asking anyone', async () => {
    const { reader, calls } = brain(() => new Response('', { status: 500 }));
    expect(await reader.read('send 5,000 to Ada for rent')).toEqual({
      kind: 'reply',
      by: 'grammar',
      reply: { actions: [{ do: 'pay', to: 'Ada', amount: 5000, note: 'rent' }] },
    });
    expect(calls).toHaveLength(0);
  });

  it('asks the server about the rest, signed by the account, with the words and no more', async () => {
    const { reader, calls, signed } = brain(() =>
      Response.json({ reply: { say: '', actions: [{ do: 'pay', to: 'Tunde', amount: 2000 }] } }),
    );
    const heard = await reader.read('abeg send Tunde 2k', { screen: 'home' });
    expect(heard).toEqual({ kind: 'reply', by: 'model', reply: { say: '', actions: [{ do: 'pay', to: 'Tunde', amount: 2000 }] } });
    expect(signed[0]).toBe(buildTurnMessage({ account: ME, timestampSeconds: calls[0]!.timestampSeconds as number }));
    expect(Object.keys(calls[0]!).sort()).toEqual(['account', 'screen', 'signature', 'text', 'timestampSeconds']);
  });

  it('says so when there is no model to ask, and does not pretend to understand', async () => {
    expect((await brain(() => new Response('', { status: 501 })).reader.read('abeg send Tunde 2k')).kind).toBe('grammar-only');
    const unreachable = brain(() => {
      throw new Error('offline');
    });
    expect((await unreachable.reader.read('abeg send Tunde 2k')).kind).toBe('grammar-only');
  });

  it('treats a model that has been asked too often as no model, not as a sentence it could not follow', async () => {
    const limited = brain(() => new Response(JSON.stringify({ error: 'rate_limited', retryAfterSeconds: 30 }), { status: 429 }));
    expect((await limited.reader.read('abeg send Tunde 2k')).kind).toBe('grammar-only');
  });

  it('a server answer outside the vocabulary is not understood, never acted on', async () => {
    const made = brain(() => Response.json({ reply: { actions: [{ do: 'confirm' }] } }));
    expect((await made.reader.read('just confirm it for me')).kind).toBe('not-understood');
    const failed = brain(() => new Response('', { status: 502 }));
    expect((await failed.reader.read('mumble mumble')).kind).toBe('not-understood');
    const empty = brain(() => Response.json({ reply: { actions: [] } }));
    expect((await empty.reader.read('mumble mumble')).kind).toBe('not-understood');
  });
});
