import { formatNaira, kobo } from './money';
import { NIGERIA_PIT_BANDS, RENT_RELIEF_BPS, RENT_RELIEF_MAX_MINOR } from './tax-ng';

/**
 * What Ayo can explain, written here and checked, never made up by a model.
 *
 * Education about how things work, in a few spoken sentences: the 2026 tax
 * bands, what safe to spend means, how Entole keeps a statement private. It is
 * not advice about what this person should do with their money; for that the
 * app answers from their own figures (`tellAbout`, `tellAfford`), and for
 * investing it says the choice is theirs.
 *
 * The tax figures are read from `tax-ng.ts`, the one place the bands live, so
 * a change to the law is made once.
 */

export const EXPLAIN_TOPICS = [
  'tax',
  'rent-relief',
  'safe-to-spend',
  'small-leaks',
  'pockets',
  'statement',
  'allowances',
  'pause',
  'savings',
] as const;

export type ExplainTopic = (typeof EXPLAIN_TOPICS)[number];

const naira = (minor: number) => formatNaira(kobo(minor));
const percent = (bps: number) => `${bps / 100}%`;

/** The bands as a person says them: "the first ₦800,000 is free, the next ₦2,200,000 at 15%, …". */
function bandsSaid(): string {
  let floor = 0;
  const parts: string[] = [];
  for (const band of NIGERIA_PIT_BANDS) {
    if (band.uptoMinor === null) {
      parts.push(`anything above ${naira(floor)} at ${percent(band.rateBps)}`);
      break;
    }
    const width = band.uptoMinor - floor;
    parts.push(band.rateBps === 0 ? `the first ${naira(width)} a year is free` : `the next ${naira(width)} at ${percent(band.rateBps)}`);
    floor = band.uptoMinor;
  }
  return parts.join(', ');
}

const KNOWLEDGE: Record<ExplainTopic, () => string> = {
  tax: () =>
    `Under the Nigeria Tax Act, in force from January 2026, ${bandsSaid()}. Income from clients abroad counts too. I can estimate yours from your statements, but it is a plan, not a filing.`,
  'rent-relief': () =>
    `If you pay rent for your home, ${percent(RENT_RELIEF_BPS)} of a year's rent comes off your taxable income, up to ${naira(RENT_RELIEF_MAX_MINOR)}. Keep your rent receipts.`,
  'safe-to-spend': () =>
    'Safe to spend is what is left for each day until money usually comes in, after the bills due before then, your savings share and tax are set aside. It comes from your own statements, so it moves as you spend.',
  'small-leaks': () =>
    'Small leaks are the little payments that are easy to miss, like rides, snacks, airtime and fees. One at a time they feel like nothing; I add them up over a month so you can see what they come to.',
  pockets: () =>
    'Pockets hold dollars, euros and pounds beside your naira. Changing between them is quoted first, so you see what arrives before anything moves, and you confirm it yourself.',
  statement: () =>
    'When you read a bank statement in Plan, it is read inside sealed hardware that even the people running it cannot look into, and the proof is shown to you. The lines are kept with your account, sealed under a key only your passkey can make, so our server cannot read them.',
  allowances: () =>
    'An allowance is money you let me pay on my own: who to, how much, and how often it resets. It only goes down as it is used, and when it runs out, I stop. Everything else, you confirm yourself.',
  pause: () =>
    'Pause is at the top of every screen. One tap and I stop paying from any allowance at once, and your allowances stay as they are until you resume.',
  savings: () =>
    'Savings keeps money apart from what you spend, in your own account, and you can take it out whenever you like. Where it earns, the savings screen shows the rate, and it moves from day to day.',
};

/** A topic, explained in a few spoken sentences. */
export function explain(topic: ExplainTopic): string {
  return KNOWLEDGE[topic]();
}
