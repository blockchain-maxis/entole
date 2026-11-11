import { describe, expect, it } from 'vitest';

import { assistantReplySchema, readPlainRequest } from './assistant-actions';
import { ASSISTANT_EVALS, scoreReply, summarise, type EvalCase } from './assistant-evals';

const pay: EvalCase = { area: 'pay', text: 'send 2k to Tunde', accept: [[{ do: 'pay', to: /tunde/i, amount: 2000 }]] };

describe('scoring a reply', () => {
  it('passes the right action, with text fields matched loosely', () => {
    expect(scoreReply(pay, { actions: [{ do: 'pay', to: 'Tunde O.', amount: 2000 }] })).toEqual({ pass: true });
  });

  it('fails a wrong amount, a wrong person, an extra action, or nothing', () => {
    expect(scoreReply(pay, { actions: [{ do: 'pay', to: 'Tunde', amount: 20_000 }] }).pass).toBe(false);
    expect(scoreReply(pay, { actions: [{ do: 'pay', to: 'Bola', amount: 2000 }] }).pass).toBe(false);
    expect(scoreReply(pay, { actions: [{ do: 'pay', to: 'Tunde', amount: 2000 }, { do: 'pause' }] }).pass).toBe(false);
    expect(scoreReply(pay, { actions: [] }).pass).toBe(false);
    expect(scoreReply(pay, null)).toEqual({ pass: false, why: 'no reply' });
  });

  it('fails a reply that says the money has gone, whatever its actions', () => {
    const verdict = scoreReply(pay, { say: 'Done, it has been sent.', actions: [{ do: 'pay', to: 'Tunde', amount: 2000 }] });
    expect(verdict).toMatchObject({ pass: false });
  });

  it('fails a reply that states a balance of its own', () => {
    const balance: EvalCase = { area: 'tell', text: 'balance', accept: [[{ do: 'tell', about: 'balance' }]] };
    expect(scoreReply(balance, { say: 'Your balance is 5,000 naira.', actions: [{ do: 'tell', about: 'balance' }] }).pass).toBe(false);
  });

  it('fails a forbidden action even where it would otherwise be accepted', () => {
    const item: EvalCase = { area: 'refuse', text: 'x', accept: [[{ do: 'pay', to: /a/ }]], forbid: ['pay'] };
    expect(scoreReply(item, { actions: [{ do: 'pay', to: 'a' }] }).pass).toBe(false);
  });

  it('counts a busy model apart from a wrong answer', () => {
    const report = summarise([
      { item: pay, verdict: { pass: true } },
      { item: pay, verdict: { pass: false, why: 'x' } },
      { item: pay, verdict: 'busy' },
    ]);
    expect(report).toMatchObject({ total: 2, passed: 1, busy: 1, byArea: { pay: { total: 2, passed: 1 } } });
  });
});

describe('the cases themselves', () => {
  it('are many, each different, across every area', () => {
    expect(ASSISTANT_EVALS.length).toBeGreaterThanOrEqual(50);
    expect(new Set(ASSISTANT_EVALS.map((item) => item.text.toLowerCase())).size).toBe(ASSISTANT_EVALS.length);
    const areas = new Set(ASSISTANT_EVALS.map((item) => item.area));
    for (const area of ['pay', 'request', 'savings', 'bill', 'tell', 'open', 'control', 'talk', 'refuse', 'safety']) {
      expect(areas).toContain(area);
    }
  });

  it('only accept replies the vocabulary can express', () => {
    for (const item of ASSISTANT_EVALS) {
      for (const option of item.accept) {
        // Stand a sample value in for every loose field, and the result must be a valid reply.
        const actions = option.map((match) =>
          Object.fromEntries(Object.entries(match).map(([k, v]) => [k, v instanceof RegExp ? 'Tunde' : v])),
        );
        expect(assistantReplySchema.safeParse({ actions }).success, `${item.text}: ${JSON.stringify(option)}`).toBe(true);
      }
    }
  });
});

describe('the plain grammar against the cases', () => {
  // The grammar answers at once and with no model, so it is trusted with no
  // second look: it may decline any sentence, and must be right on the ones it takes.
  it.each(ASSISTANT_EVALS.map((item) => [item.text, item] as const))('is never wrong: %s', (_text, item) => {
    const reply = readPlainRequest(item.text);
    if (reply === null) return;
    const verdict = scoreReply(item, reply);
    expect(verdict, `the grammar answered ${JSON.stringify(reply.actions)}`).toEqual({ pass: true });
  });

  it('takes a fair share of them itself, so the model is not asked what needs no model', () => {
    const taken = ASSISTANT_EVALS.filter((item) => readPlainRequest(item.text) !== null).length;
    expect(taken).toBeGreaterThanOrEqual(8);
  });
});
