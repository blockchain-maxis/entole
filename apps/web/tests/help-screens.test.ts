import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('feedback and help, in the browser', () => {
  const help = read('app/help/page.tsx');
  const me = read('app/me/page.tsx');
  const glass = read('components/GlassSheet.tsx');
  const feedback = read('components/FeedbackDialog.tsx');
  const bot = read('components/HelpBotDialog.tsx');
  const support = read('lib/support.ts');

  it('Me opens the help center and the feedback sheet, instead of a mail link', () => {
    expect(me).toMatch(/label="Help center" onClick=\{\(\) => router\.push\('\/help'\)\}/);
    expect(me).toMatch(/label="Send feedback" onClick=\{\(\) => setFeedbackOpen\(true\)\}/);
    expect(me).not.toMatch(/mailto:/);
    expect(me).toMatch(/label="Unlocked"/);
    expect(me).toMatch(/label="Locks itself"/);
    expect(me).not.toMatch(/label="Session"/);
  });

  it('glass is a blurred pane with a wash, a sheen and a lit rim, and a dialog for a screen reader', () => {
    expect(glass).toMatch(/supports-\[backdrop-filter\]:backdrop-blur-2xl/);
    expect(glass).toMatch(/bg-gradient-to-b from-card\/70 to-transparent/);
    expect(glass).toMatch(/role="dialog"/);
    expect(glass).toMatch(/aria-modal="true"/);
    expect(glass).toMatch(/event\.key === 'Escape'/);
  });

  it('feedback says thank you only once it has gone, and leaves through the server', () => {
    expect(feedback).toMatch(/if \(result\.ok\) \{\s*setPhase\('thanks'\);/);
    expect(feedback).toMatch(/Thank you for your feedback/);
    expect(support).toMatch(/feedbackSchema\.safeParse\(body\)/);
    expect(support).toMatch(/helpAnswerSchema\.safeParse/);
    expect(support).not.toMatch(/RESEND|re_[A-Za-z0-9]{8,}/);
  });

  it('the help center lists questions that open to answers, from the articles the bot uses', () => {
    expect(help).toMatch(/HELP_ARTICLES\.filter\(/);
    expect(help).toMatch(/aria-expanded=\{expanded\}/);
    expect(bot).toMatch(/askHelp\(text, history\)/);
  });

  it('a help button floats at the bottom right and opens the bot, which waits as a skeleton and can be rated', () => {
    expect(help).toMatch(/fixed [^"]*right-5/);
    expect(help).toMatch(/aria-label="Ask for help"/);
    expect(bot).toMatch(/<Skeleton /);
    expect(bot).not.toMatch(/LogoLoader/);
    expect(bot).toMatch(/rateHelp\(turn\.id, helpful\)/);
  });
});
