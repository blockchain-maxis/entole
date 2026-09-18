import { describe, expect, it } from 'vitest';

import { demoGateway } from './gateway';

/**
 * `settlePotShare` is the one piece of the demo gateway with real branching
 * logic — the terminal state PRODUCT.md promises (a pot resolves to zero
 * and closes) lives here.
 */
describe('demoGateway.settlePotShare', () => {
  it('clears your own owed balance and folds it into collected', async () => {
    const before = await demoGateway.loadSnapshot();
    const pot = before.pots[0]!;
    const you = pot.members.find((m) => m.isYou)!;
    expect(you.owedMinor).toBeGreaterThan(0);

    const after = await demoGateway.settlePotShare(pot.id);

    expect(after).not.toBeNull();
    const updatedYou = after!.members.find((m) => m.isYou)!;
    expect(updatedYou.owedMinor).toBe(0);
    expect(updatedYou.paidMinor).toBe(you.paidMinor + you.owedMinor);
    expect(after!.collectedMinor).toBe(pot.collectedMinor + you.owedMinor);
  });

  it('throws for a pot that does not exist', async () => {
    await expect(demoGateway.settlePotShare('not-a-pot')).rejects.toThrow();
  });
});
