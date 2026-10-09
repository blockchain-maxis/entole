import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/**
 * The web twin of the phone's assistant-action sheet. The hard rules it must
 * keep are structural, so they are asserted on the source (the web tests run
 * without a DOM): an undo window rather than a confirm dialog, the assistant
 * mark on every state, and no "sent" before the payment has settled.
 */
describe('the assistant action page', () => {
  const page = read('app/assistant/action/page.tsx');

  it('runs and cancels through the store, never a made-up success', () => {
    expect(page).toMatch(/store\.runProposal\(\)/);
    expect(page).toMatch(/store\.cancelProposal\(\)/);
  });

  it('only says it sent after the receipt exists', () => {
    // `Entole sent` lives only in the panel that is given a settled receipt.
    const sentPanel = page.slice(page.indexOf('function SentPanel'));
    expect(sentPanel).toMatch(/Entole sent/);
    expect(page.slice(0, page.indexOf('function SentPanel'))).not.toMatch(/Entole sent/);
    expect(page).toMatch(/receipt \?\s*\(\s*<SentPanel/);
  });

  it('marks every state as the assistant, and keeps the pause control in the header', () => {
    expect(page.match(/<AssistantBadge/g)?.length).toBeGreaterThanOrEqual(2);
    expect(page).toMatch(/<Header/);
  });

  it('gives a stop control while the undo window is open', () => {
    expect(page).toMatch(/Cancel this payment/);
    expect(page).toMatch(/<Countdown/);
  });
});

describe('home announces a waiting proposal only when the assistant is on', () => {
  const home = read('app/page.tsx');
  it('gates on the assistant setting', () => {
    expect(home).toMatch(/assistant\.enabled && Boolean\(store\.proposal\)/);
    expect(home).toMatch(/\/assistant\/action/);
  });
});
