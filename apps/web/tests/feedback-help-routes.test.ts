import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as ask } from '@/app/api/help/ask/route';
import { POST as feedback } from '@/app/api/feedback/route';
import { POST as rate } from '@/app/api/help/rate/route';
import { resetRateLimits } from '@/lib/server/sponsor';

/**
 * Feedback goes out as an email to the owner, and a question to the help bot is
 * answered from the help articles. No network: Resend and the model are a
 * stubbed `fetch`, and there is no Redis, so nothing is kept.
 */
let ip = 0;
function post(body: unknown) {
  return new Request('http://localhost/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.${Math.floor(ip / 250)}.${(ip += 1) % 250}` },
    body: JSON.stringify(body),
  });
}

const FEEDBACK = {
  kind: 'problem',
  message: 'The balance shows slowly when I open the app',
  email: 'ada@example.com',
  from: { platform: 'android', username: 'ada', name: 'Ada Eze', version: '0.1.0', screen: 'Home' },
};

const ENV = ['RESEND_API_KEY', 'FEEDBACK_TO_EMAIL', 'FEEDBACK_FROM_EMAIL', 'FEEDBACK_DAILY', 'KIMI_API_KEY', 'HELP_DAILY_QUESTIONS'];

beforeEach(() => {
  resetRateLimits();
  for (const key of ENV) delete process.env[key];
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /api/feedback', () => {
  it('says it is not set up when there is no Resend key or inbox', async () => {
    expect((await feedback(post(FEEDBACK))).status).toBe(501);
    process.env.RESEND_API_KEY = 're_test';
    expect((await feedback(post(FEEDBACK))).status).toBe(501);
  });

  it('mails what was written to the owner, with a reply address, and nothing else', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.FEEDBACK_TO_EMAIL = 'owner@example.com';
    const fetchMock = vi.fn(async () => Response.json({ id: 'email_1' }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await feedback(post(FEEDBACK));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer re_test');
    const sent = JSON.parse(init.body) as Record<string, unknown>;
    expect(sent.to).toEqual(['owner@example.com']);
    expect(sent.reply_to).toBe('ada@example.com');
    expect(sent.from).toBe('Entole feedback <onboarding@resend.dev>');
    expect(sent.subject).toMatch(/^\[Entole feedback\] Something is wrong: The balance shows slowly/);
    expect(sent.text).toContain('From: Ada Eze @ada');
    expect(sent.html).toBeUndefined();
    expect(JSON.stringify(sent)).not.toMatch(/0x[0-9a-fA-F]{8,}/);
  });

  it('uses the sender it is given once a domain is verified', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.FEEDBACK_TO_EMAIL = 'owner@example.com';
    process.env.FEEDBACK_FROM_EMAIL = 'Entole <feedback@entole.pro>';
    const fetchMock = vi.fn(async () => Response.json({ id: 'x' }));
    vi.stubGlobal('fetch', fetchMock);
    await feedback(post(FEEDBACK));
    const init = (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1];
    expect(JSON.parse(init.body).from).toBe('Entole <feedback@entole.pro>');
  });

  it('refuses a message that is empty or from nowhere it knows', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.FEEDBACK_TO_EMAIL = 'owner@example.com';
    vi.stubGlobal('fetch', vi.fn());
    expect((await feedback(post({ ...FEEDBACK, message: '' }))).status).toBe(400);
    expect((await feedback(post({ ...FEEDBACK, from: { platform: 'fridge' } }))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says so when the mail service refuses or cannot be reached', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.FEEDBACK_TO_EMAIL = 'owner@example.com';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 403 })));
    expect((await feedback(post(FEEDBACK))).status).toBe(502);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    expect((await feedback(post(FEEDBACK))).status).toBe(502);
  });

  it('is bounded: a caller a minute, and everyone a day', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.FEEDBACK_TO_EMAIL = 'owner@example.com';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'x' })));
    const same = () =>
      new Request('http://localhost/api', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.8.8.8' },
        body: JSON.stringify(FEEDBACK),
      });
    const codes: number[] = [];
    for (let i = 0; i < 6; i += 1) codes.push((await feedback(same())).status);
    expect(codes.slice(0, 4)).toEqual([200, 200, 200, 200]);
    expect(codes.slice(4)).toEqual([429, 429]);

    resetRateLimits();
    process.env.FEEDBACK_DAILY = '2';
    const statuses = [(await feedback(post(FEEDBACK))).status, (await feedback(post(FEEDBACK))).status, (await feedback(post(FEEDBACK))).status];
    expect(statuses).toEqual([200, 200, 429]);
  });
});

describe('POST /api/help/ask', () => {
  it('answers from the best article when there is no model key', async () => {
    const response = await ask(post({ question: 'how do I send money' }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; answer: string; articles: string[]; by: string };
    expect(body.by).toBe('article');
    expect(body.articles).toEqual(['send-money']);
    expect(body.answer).toMatch(/Tap Send/);
    expect(body.id).toBeTruthy();
  });

  it('says it is not sure, and where to go, for a question the help does not cover', async () => {
    const body = (await (await ask(post({ question: 'recommend me a good restaurant' }))).json()) as { answer: string; by: string };
    expect(body.by).toBe('none');
    expect(body.answer).toMatch(/not sure/);
    expect(body.answer).toMatch(/support@entole\.pro/);
  });

  it('asks the model, told to answer only from the articles, when there is a key', async () => {
    process.env.KIMI_API_KEY = 'k';
    const fetchMock = vi.fn(async () =>
      Response.json({ choices: [{ message: { content: JSON.stringify({ answer: 'Open Send and pick the person.', articles: ['send-money'] }) } }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const body = (await (await ask(post({ question: 'how do i send money' }))).json()) as { answer: string; by: string };
    expect(body).toMatchObject({ by: 'model', answer: 'Open Send and pick the person.' });
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body) as { messages: { content: string }[] };
    expect(sent.messages.map((message) => message.content).join('\n')).toContain('Answer ONLY from them');
  });

  it('keeps answering from the articles once the model’s day is spent', async () => {
    process.env.KIMI_API_KEY = 'k';
    process.env.HELP_DAILY_QUESTIONS = '1';
    const fetchMock = vi.fn(async () =>
      Response.json({ choices: [{ message: { content: JSON.stringify({ answer: 'From the model.', articles: ['send-money'] }) } }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const first = (await (await ask(post({ question: 'how do i send money' }))).json()) as { by: string };
    const second = (await (await ask(post({ question: 'how do i send money' }))).json()) as { by: string };
    expect(first.by).toBe('model');
    expect(second.by).toBe('article');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a question that is empty or far too long, and one caller too many', async () => {
    expect((await ask(post({ question: '' }))).status).toBe(400);
    expect((await ask(post({ question: 'x'.repeat(400) }))).status).toBe(400);
    const same = () =>
      new Request('http://localhost/api', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.7.7.7' },
        body: JSON.stringify({ question: 'how do I send money' }),
      });
    const codes: number[] = [];
    for (let i = 0; i < 14; i += 1) codes.push((await ask(same())).status);
    expect(codes.filter((code) => code === 429).length).toBe(2);
  });
});

describe('POST /api/help/rate', () => {
  it('takes a thumbs up or down, and says the same whether or not it could be kept', async () => {
    expect((await rate(post({ id: 'abc123', helpful: false }))).status).toBe(200);
    expect((await rate(post({ id: '', helpful: true }))).status).toBe(400);
    expect((await rate(post({ id: 'abc', helpful: 'yes' }))).status).toBe(400);
  });
});
