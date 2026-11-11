import { describe, expect, it } from 'vitest';

import { readWithModel } from './assistant-brain';

const actionsOf = async (...args: Parameters<typeof readWithModel>) => {
  const read = await readWithModel(...args);
  return read.ok ? read.reply.actions : [];
};

/**
 * The real model, asked three real sentences. Skipped unless `KIMI_API_KEY`
 * is set, so it never runs in CI or on a machine without the key:
 *
 *   KIMI_API_KEY=… pnpm --filter @entole/core exec vitest run assistant-brain.live
 */
const apiKey = process.env.KIMI_API_KEY?.trim();

describe.skipIf(!apiKey)('Kimi, live', () => {
  const config = {
    apiKey: apiKey ?? '',
    model: process.env.ASSISTANT_MODEL?.trim() || undefined,
    apiUrl: process.env.ASSISTANT_API_URL?.trim() || undefined,
  };

  it('gets a payment ready from Pidgin, without confirming it', async () => {
    const actions = await actionsOf('abeg send Tunde 2k for fuel', config);
    expect(actions[0]).toMatchObject({ do: 'pay', to: expect.stringMatching(/tunde/i), amount: 2000 });
  }, 30_000);

  it('opens Receive when someone wants to be paid', async () => {
    const actions = await actionsOf('how will people pay me', config);
    expect(actions.some((action) => action.do === 'request' || (action.do === 'open' && action.screen === 'receive'))).toBe(true);
  }, 30_000);

  it('asks for the real balance instead of inventing one', async () => {
    const actions = await actionsOf('wetin be my balance', config);
    expect(actions).toContainEqual({ do: 'tell', about: 'balance' });
  }, 30_000);
});
