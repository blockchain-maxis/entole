import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The same hard rules the phone app is held to, checked against the web app.
 * The rules are the product thesis, so they apply to whatever renders them.
 */

const ROOT = join(__dirname, '..');
const PAGES = join(ROOT, 'app');
const COMPONENTS = join(ROOT, 'components');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.tsx') || path.endsWith('.ts') ? [path] : [];
  });
}

const sourceFiles = [...walk(PAGES), ...walk(COMPONENTS)];

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Comments are not shipped copy, so they are removed before scanning. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

/**
 * Everything a person can actually read: JSX text nodes plus the props that
 * become visible or spoken copy.
 */
function userFacingCopy(source: string): string[] {
  const body = stripComments(source);
  const jsxText = [...body.matchAll(/>([^<>{}]+)</g)].map((match) => match[1] ?? '');
  const props = [
    ...body.matchAll(/(?:label|title|aria-label|placeholder)=(?:\{)?["'`]([^"'`]+)/g),
  ].map((match) => match[1] ?? '');
  return [...jsxText, ...props].map((text) => text.trim()).filter(Boolean);
}

describe('the blockchain is never mentioned', () => {
  const banned = [
    'wallet',
    'crypto',
    'blockchain',
    'chain',
    'gas',
    'token',
    'on-chain',
    'signature',
    'transaction hash',
    'seed phrase',
    'recovery phrase',
  ];

  it.each(sourceFiles)('%s uses none of the banned words in copy', (file) => {
    const offences = userFacingCopy(read(file)).flatMap((copy) =>
      banned
        .filter((word) => new RegExp(`\\b${word.replace('-', '[- ]')}\\b`, 'i').test(copy))
        .map((word) => `"${copy}" contains "${word}"`),
    );
    expect(offences, `${relative(ROOT, file)}\n${offences.join('\n')}`).toEqual([]);
  });
});

describe('no seed phrase exists anywhere', () => {
  it.each(sourceFiles)('%s never mentions one, even internally', (file) => {
    expect(read(file)).not.toMatch(/seed phrase|recovery phrase|mnemonic/i);
  });
});

describe('design tokens are referenced by name', () => {
  it.each(sourceFiles)('%s has no hardcoded hex value', (file) => {
    const hexes = stripComments(read(file)).match(/#[0-9A-Fa-f]{3,8}\b/g) ?? [];
    expect(hexes, `${relative(ROOT, file)} hardcodes ${hexes.join(', ')}`).toEqual([]);
  });
});

describe('the pause control is reachable from every page header', () => {
  const pages = walk(PAGES).filter((file) => file.endsWith('page.tsx'));

  it('finds pages to check', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  // The public checkout page (`/pay/[code]`) is for people who may not have an
  // account, so it renders `CheckoutHeader`, which draws the same pause control
  // whenever someone is signed in (asserted in "the public checkout page" below).
  // The page a bank transfer returns to (`/add-money/return`) is public for the
  // same reason and carries the same header. So do the Terms and the Privacy
  // notice (`LegalPage`), which have to be readable before an account exists.
  const PUBLIC_PAGES = [join('pay', ''), join('add-money', 'return', ''), join('legal', '')];
  const isCheckout = (file: string) => PUBLIC_PAGES.some((prefix) => relative(PAGES, file).startsWith(prefix));

  it.each(pages.filter((file) => !isCheckout(file)))('%s renders the shared header', (file) => {
    expect(read(file)).toMatch(/<Header/);
  });

  it('the page a bank transfer returns to carries the checkout header, and no account detail', () => {
    const page = stripComments(read(join(PAGES, 'add-money/return/page.tsx')));
    expect(page).toMatch(/<CheckoutHeader\s*\/>/);
    expect(page).not.toMatch(/useStore|useAccount|balance/i);
  });

  it('the shared header always carries the control', () => {
    expect(read(join(COMPONENTS, 'Header.tsx'))).toMatch(/<PauseControl\s*\/>/);
  });
});

describe('assistant actions are visually distinct', () => {
  it('the feed row uses the assistant tint token', () => {
    const feed = read(join(COMPONENTS, 'ActivityRow.tsx'));
    expect(feed).toMatch(/bg-indigo-wash/);
    expect(feed).toMatch(/AssistantBadge/);
  });
});

describe('two inks: black is the person, blue is the assistant', () => {
  // Blue used to be the link, selection, focus and button-hover colour as well
  // as the assistant's, so it said nothing. It is now only ever the assistant.
  const ASSISTANT_SURFACES = [
    'app/assistant/action/page.tsx',
    'app/assistant/page.tsx',
    'app/connections/page.tsx',
    'app/page.tsx',
    'app/rules/[id]/page.tsx',
    'components/ActivityRow.tsx',
    'components/AllowanceCard.tsx',
    'components/AllowanceIntro.tsx',
    'components/Badge.tsx',
    'components/Countdown.tsx',
    // The logo: a blue ring, the brand's own and not the assistant's.
    'components/Header.tsx',
    // The first page shows an allowance, in the assistant's blue.
    'components/Landing.tsx',
    // The logo again, drawing itself.
    'components/LogoLoader.tsx',
  ];

  it('blue appears only where the assistant has acted or may act', () => {
    const blue = sourceFiles
      .filter((file) => /indigo/.test(stripComments(read(file))))
      .map((file) => relative(ROOT, file).split(sep).join('/'))
      .sort();
    expect(blue).toEqual(ASSISTANT_SURFACES);
  });

  it('on the home screen blue is only the two assistant banners', () => {
    const home = stripComments(read(join(PAGES, 'page.tsx')));
    const lines = home.split('\n').filter((line) => /indigo/.test(line));
    // Each banner's ground, and the arrow inside the second.
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).toMatch(/rounded-control bg-indigo-wash|<ArrowRight/);
  });

  it('a primary button is ink, and stays ink when hovered', () => {
    const button = stripComments(read(join(COMPONENTS, 'Button.tsx')));
    expect(button).toMatch(/bg-ink/);
    for (const file of sourceFiles) {
      expect(read(file), relative(ROOT, file)).not.toMatch(/hover:bg-indigo|focus(-within)?:border-indigo/);
    }
  });

  it('keyboard focus is always drawn, in ink', () => {
    const stylesheet = read(join(PAGES, 'globals.css'));
    expect(stylesheet).toMatch(/:focus-visible \{\s*outline: 2px solid rgb\(var\(--color-ink\)\);/);
  });
});

describe('home is written on paper: one figure, sentences, ruled rows', () => {
  const home = stripComments(read(join(PAGES, 'page.tsx')));

  it('the balance is the figure, in the display face, with no card around it', () => {
    expect(home).toMatch(/<Figure value=\{store\.balance\} \/>/);
    const balance = /aria-label="Your balance"[^>]*>/.exec(home)?.[0] ?? '';
    expect(balance).not.toMatch(/bg-card|shadow-|border/);
    expect(stripComments(read(join(COMPONENTS, 'Amount.tsx')))).toMatch(/tabular font-display/);
  });

  it('offers sending, adding and receiving, in that order', () => {
    const actions = [...home.matchAll(/<ButtonLink href="([^"]+)" label="([^"]+)"/g)].map((match) => `${match[2]} ${match[1]}`);
    expect(actions).toEqual(['Send /transfer', 'Add money /add-money', 'Receive /receive']);
  });

  it('an allowance is a sentence in the assistant\'s blue, with what is left and the meter', () => {
    const row = stripComments(read(join(COMPONENTS, 'AllowanceCard.tsx')));
    expect(row).toMatch(/font-display-plain text-prose text-indigo/);
    expect(row).toMatch(/cadenceWords\(allowance\.cadence\)/);
    expect(row).toMatch(/formatNaira\(allowance\.remainingMinor\)/);
    expect(row).toMatch(/<Meter/);
    expect(row).not.toMatch(/border border-line bg-card/);
  });

  it('never leaves a heading over nothing', () => {
    expect(home).toMatch(/store\.allowances\.length === 0 \? \(\s*<AllowanceIntro \/>/);
    expect(home).toMatch(/store\.activity\.length === 0 \? \(\s*<EmptyState/);
  });

  it('a list holds items: the allowance row is a link inside its item', () => {
    expect(stripComments(read(join(COMPONENTS, 'AllowanceCard.tsx')))).toMatch(/<li>\s*<Link href=\{href\}/);
    expect(home).not.toMatch(/<Link[^>]*>\s*<AllowanceCard/);
  });
});

describe('an allowance is a sentence you fill in, never a form', () => {
  const rule = stripComments(read(join(PAGES, 'rules/new/page.tsx')));
  const sentence = stripComments(read(join(COMPONENTS, 'Sentence.tsx')));

  it('is built from words and four blanks: how much, who, how often, the limit', () => {
    expect(rule).toMatch(/<Sentence parts=\{parts\}/);
    expect([...rule.matchAll(/kind: 'blank', id: '(\w+)'/g)].map((match) => match[1])).toEqual([
      'each',
      'who',
      'often',
      'limit',
    ]);
  });

  it('has no form control for choosing: no dropdown, no checkbox', () => {
    expect(rule).not.toMatch(/<select|type="checkbox"|role="switch"/);
  });

  it('marks the blank being changed in ink, and one still empty with a dashed edge', () => {
    expect(sentence).toMatch(/part\.id === activeId\s*\? 'border-ink bg-ink text-paper'/);
    expect(sentence).toMatch(/border-dashed/);
    expect(sentence).not.toMatch(/indigo/);
  });
});

describe('the logo is the Entole mark, the same one as the app icon', () => {
  // An arch was drawn here once, and an "E" on a tile on the phone. Neither was
  // the logo. The mark is the open blue ring with a dot and a bar, as the icon.
  const header = read(join(COMPONENTS, 'Header.tsx'));
  const icon = read(join(ROOT, 'public/icons/icon.svg'));

  it('draws the same three shapes as the icon file', () => {
    for (const shape of ['M50 16 A34 34 0 1 1 16 50', 'M4 50 H26']) {
      expect(icon).toContain(shape);
      expect(header).toContain(shape);
    }
    expect(header).toMatch(/<circle cx="50" cy="50" r="7"/);
  });

  it('is what the first screen and the pay page show', () => {
    expect(read(join(COMPONENTS, 'CheckoutHeader.tsx'))).toMatch(/<BrandGlyph/);
    expect(header).not.toMatch(/a6 6 0 0 1 12 0/);
  });
});

describe('the one thing that turns is the Entole mark', () => {
  const loader = read(join(COMPONENTS, 'LogoLoader.tsx'));
  const stylesheet = read(join(PAGES, 'globals.css'));

  it('is the logo itself, its ring drawing round to the bar', () => {
    expect(loader).toContain('M50 16 A34 34 0 1 1 16 50');
    expect(loader).toContain('M4 50 H26');
    expect(loader).toMatch(/pathLength=\{100\}/);
    expect(stylesheet).toMatch(/@keyframes logo-ring/);
  });

  it('is still for someone who asked for less motion', () => {
    const reduced = [...stylesheet.matchAll(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g)].map(
      (match) => match[0],
    );
    expect(reduced.some((block) => /\.logo-ring/.test(block) && /animation: none/.test(block))).toBe(true);
  });

  it('is said aloud as what it is waiting for, and nothing else in the app spins', () => {
    expect(loader).toMatch(/role="status" aria-label=\{label\}/);
    for (const file of sourceFiles) {
      expect(read(file), relative(ROOT, file)).not.toMatch(/animate-spin/);
    }
  });

  it('covers the moment before anything is known, never a list that has a shape', () => {
    expect(stripComments(read(join(COMPONENTS, 'AuthGate.tsx')))).toMatch(/if \(onboarded === null\) return <PageLoader \/>;/);
    for (const page of ['page.tsx', 'activity/page.tsx', 'transfer/page.tsx']) {
      expect(read(join(PAGES, page)), page).not.toMatch(/LogoLoader|PageLoader/);
    }
  });
});

describe('the first page says what Entole is, shows it, and has one way in', () => {
  const landing = stripComments(read(join(COMPONENTS, 'Landing.tsx')));
  const copy = userFacingCopy(read(join(COMPONENTS, 'Landing.tsx'))).join('\n');

  it('has one label for starting and one for coming back', () => {
    expect(landing.match(/>\s*Get started\s*</g)?.length).toBe(2);
    expect(landing.match(/I already have an account/g)?.length).toBe(1);
    expect(copy).not.toMatch(/Sign up|Create account|Log in|Sign in/);
  });

  it('shows the product with its own parts, and says it is an example', () => {
    expect(landing).toMatch(/<AllowanceCard/);
    expect(landing).toMatch(/<ActivityRow/);
    expect(landing).toMatch(/<Figure/);
    expect(landing).toMatch(/An example account/);
    // What is drawn as the product cannot be pressed or read aloud as real.
    expect(landing).toMatch(/aria-hidden\s+inert/);
  });

  it('says what does not work yet, in the same breath as what does', () => {
    expect(copy).toMatch(/What works today/);
    expect(copy).toMatch(/Not yet/);
    expect(landing).toMatch(/Everything runs on test money for now/);
  });

  it('is laid out for a desk as well as a phone, and never names what it is built on', () => {
    expect(landing).toMatch(/lg:grid-cols-/);
    expect(landing).not.toMatch(/max-w-\[560px\]/);
    expect(copy).not.toMatch(/Monad|testnet|mainnet/i);
    expect(copy).not.toMatch(/[\u2014\u2013]/);
  });
});

describe('the undo window drains continuously, against the clock', () => {
  const countdown = stripComments(read(join(COMPONENTS, 'Countdown.tsx')));

  it('measures time instead of counting ticks', () => {
    expect(countdown).toMatch(/performance\.now\(\)/);
    expect(countdown).not.toMatch(/current - 1/);
  });

  it('slides the bar at one steady speed, and steps it for someone who asked for less motion', () => {
    expect(countdown).toMatch(/countdown-drain/);
    expect(countdown).toMatch(/prefers-reduced-motion: reduce/);
    expect(read(join(PAGES, 'globals.css'))).toMatch(/animation-timing-function: linear;/);
  });
});

describe('the assistant is a setting the person turns on, never a default', () => {
  const session = stripComments(read(join(ROOT, 'lib/session.ts')));

  it('signing in derives only the owner key — the assistant key is derived in one place', () => {
    const calls = session.match(/deriveSessionAccount\(/g) ?? [];
    expect(calls).toHaveLength(1);
    const derive = session.slice(session.indexOf('deriveAssistantAccount('));
    expect(derive).toMatch(/deriveSessionAccount\(/);
    expect(session).toMatch(/session: null/);
  });

  it('starts off, and only the approval screen turns it on', () => {
    const provider = stripComments(read(join(ROOT, 'lib/assistant.tsx')));
    expect(provider).toMatch(/useState\(false\)/);
    const enablers = sourceFiles.filter((file) => /\.enable\(\)/.test(stripComments(read(file))));
    expect(enablers.map((file) => relative(ROOT, file).split(sep).join('/'))).toEqual([
      'app/assistant/page.tsx',
    ]);
  });

  it('the introduction leads to the approval screen while the assistant is off, and cannot be waved away', () => {
    const intro = stripComments(read(join(ROOT, 'components/AllowanceIntro.tsx')));
    expect(intro).toMatch(/Turn on the assistant/);
    expect(intro).toMatch(/href=\{assistant\.enabled \? '\/rules\/new' : '\/assistant'\}/);
    expect(intro).not.toMatch(/Got it|Not now|\.enable\(/);
  });

  it('the header chip shows Off, and off leads to the approval page rather than a pause', () => {
    const button = stripComments(read(join(ROOT, 'components/PauseControl.tsx')));
    expect(button).toMatch(/Assistant · Off/);
    expect(button).toMatch(/href="\/assistant"/);
  });

  it('the approval screen shows an action, not a toggle or a permission', () => {
    const screen = stripComments(read(join(ROOT, 'app/assistant/page.tsx')));
    expect(screen).not.toMatch(/type="checkbox"|role="switch"/);
    expect(screen).toMatch(/Turn on the assistant/);
  });
});

describe('an account made on another device can be signed in to, not only made again', () => {
  // A new browser used to offer one thing, a new passkey, and so a new and
  // empty account every time. The passkey that made an account derives it
  // again on any device that can reach that passkey.
  const session = read(join(ROOT, 'lib/session.ts'));
  const signIn = /export async function signInWithExistingPasskey[\s\S]*?\n}\n/.exec(session)?.[0] ?? '';
  const gate = stripComments(read(join(COMPONENTS, 'AuthGate.tsx')));

  it('the first screen offers it beside starting new', () => {
    expect(read(join(COMPONENTS, 'Landing.tsx'))).toMatch(/I already have an account/);
    expect(gate).toMatch(/onSignIn=\{\(\) => void signInFromElsewhere\(\)\}/);
    expect(gate).toMatch(/signInWithExistingPasskey\(\)/);
  });

  it('signing in names no passkey and makes none', () => {
    expect(signIn).toMatch(/signInToOwnerAccount\(\{ rpId: RP_ID \}\)/);
    expect(signIn).not.toMatch(/createOwnerAccount|loadCredential/);
  });

  it('keeps the passkey it was given, so the next unlock asks for that one', () => {
    expect(signIn).toMatch(/storeCredential\(owner\.credential\)/);
  });

  it('asks a returning person their name without making another passkey', () => {
    const onboard = /async function onboard\(\)[\s\S]*?\n  }\n/.exec(gate)?.[0] ?? '';
    expect(onboard.indexOf('if (returning)')).toBeGreaterThan(-1);
    expect(onboard.indexOf('if (returning)')).toBeLessThan(onboard.indexOf('registerAccount('));
    expect(/if \(returning\) \{[\s\S]*?return;/.exec(onboard)?.[0]).not.toMatch(/registerAccount/);
  });
});

describe('a person can be saved in the browser, so an allowance can be set there', () => {
  // An allowance is for a saved person, and only the phone app could save one.
  // In a browser that left the assistant with nobody it could ever pay.
  const send = stripComments(read(join(PAGES, 'transfer/send/page.tsx')));
  const save = stripComments(read(join(COMPONENTS, 'SaveRecipient.tsx')));
  const rule = stripComments(read(join(PAGES, 'rules/new/page.tsx')));

  it('the receipt for a payment by code offers to save them', () => {
    expect(send).toMatch(/isOneOffId\(receipt\.contactId\) \? <SaveRecipient recipientId=\{receipt\.contactId\} \/>/);
    expect(send).not.toMatch(/from the phone app/);
  });

  it('saves through the shared record and never handles where the money lands', () => {
    expect(save).toMatch(/beneficiaryFromOneOff\(/);
    expect(save).toMatch(/source\.saveBeneficiary\(outcome\.beneficiary\)/);
    expect(save).not.toMatch(/\.address\b|oneOffAddress|0x/);
  });

  it('leads on to an allowance for the person just saved', () => {
    expect(save).toMatch(/\/rules\/new\?for=\$\{encodeURIComponent\(done\.id\)\}/);
    expect(rule).toMatch(/useSearchParams\(\)\.get\('for'\)/);
  });

  it('says how to get someone to set an allowance for, where there is nobody yet', () => {
    expect(rule).toMatch(/store\.contacts\.length === 0/);
    expect(rule).toMatch(/href="\/transfer\/send"/);
  });

  it('does not hold a choice made before the saved people had loaded', () => {
    expect(rule).not.toMatch(/useState\(store\.contacts\[0\]/);
  });
});

describe('no screen leaves a person stuck or misled', () => {
  const rule = stripComments(read(join(PAGES, 'rules/new/page.tsx')));
  const detail = stripComments(read(join(PAGES, 'rules/[id]/page.tsx')));
  const home = stripComments(read(join(PAGES, 'page.tsx')));

  it('an allowance can be created as soon as it has an amount: the limit starts at one payment', () => {
    expect(rule).toMatch(/limitEntry \? kobo\(entryToMinor\(limitEntry\)\) : each/);
    // Both amounts are in the sentence at once, not one behind a link.
    expect(rule).toMatch(/id: 'each', text: each > 0 \? formatNaira\(each\)/);
    expect(rule).toMatch(/id: 'limit', text: limit > 0 \? formatNaira\(limit\)/);
  });

  it('says why an allowance cannot be created yet, and when saving one fails', () => {
    expect(rule).toMatch(/Enter how much each payment is\./);
    expect(rule).toMatch(/The limit has to cover at least one payment\./);
    // And says why, when the reason is one a person can act on ("Not confirmed").
    expect(/async function save\(\)[\s\S]*?\n  }\n/.exec(rule)?.[0]).toMatch(
      /catch \(error\) \{\s*setProblem\(plainMessage\(error, "We couldn't create that allowance\./,
    );
  });

  it('a failed load never shows a balance of nothing', () => {
    const failed = /\) : failed \? \([\s\S]*?\n\s*\) : \(/.exec(home)?.[0] ?? '';
    expect(failed).toMatch(/We couldn&apos;t load your account/);
    expect(failed).not.toMatch(/<Amount|<Figure|store\.balance/);
  });

  it('an allowance still loading is not called gone', () => {
    expect(detail).toMatch(/!allowance && store\.status === 'loading'/);
    expect(detail.indexOf("store.status === 'loading'")).toBeLessThan(detail.indexOf('no longer exists'));
  });

  it('revoking an allowance, and forgetting this browser, each ask first', () => {
    expect(detail).toMatch(/onClick=\{\(\) => setAsking\(true\)\}/);
    expect(detail).toMatch(/Revoke this allowance\?/);
    const me = stripComments(read(join(PAGES, 'me/page.tsx')));
    expect(me).toMatch(/onClick=\{\(\) => setConfirmingReset\(true\)\}/);
    expect(me).not.toMatch(/<LinkRow[^>]*onClick=\{signOutEverywhere\}/);
  });

  it('the tab bar steps aside where it would cover the only button', () => {
    const nav = stripComments(read(join(COMPONENTS, 'BottomNav.tsx')));
    expect(nav).toMatch(/BARE = new Set\(\['\/assistant\/action', '\/offline'\]\)/);
    expect(nav).toMatch(/if \(BARE\.has\(pathname\)\) return null;/);
  });

  it('the public pay page leads with a way that works, and what is not open yet comes last', () => {
    const checkout = stripComments(read(join(COMPONENTS, 'Checkout.tsx')));
    const options = /export function PaymentOptions[\s\S]*?\n}\n/.exec(checkout)?.[0] ?? '';
    // With no partner, paying in this browser is the main button.
    expect(options).toMatch(/href=\{browserSendPathFor\(checkout\)\} className=\{onrampUrl \? SECONDARY : PRIMARY\}/);
    const browser = options.indexOf('browserSendPathFor(checkout)');
    const app = options.indexOf('appLinkFor(checkout)');
    const notYet = options.indexOf('Bank and card payments open soon');
    expect(browser).toBeGreaterThan(-1);
    expect(browser).toBeLessThan(app);
    expect(app).toBeLessThan(notYet);
  });
});

describe('the public checkout page', () => {
  const page = read(join(PAGES, 'pay/[code]/page.tsx'));
  const checkoutFiles = [
    join(PAGES, 'pay/[code]/page.tsx'),
    join(COMPONENTS, 'Checkout.tsx'),
    join(COMPONENTS, 'CheckoutHeader.tsx'),
  ];

  it('reads params and searchParams as promises, the Next 16 way', () => {
    expect(page).toMatch(/params: Promise</);
    expect(page).toMatch(/searchParams: Promise</);
    expect(page).toMatch(/await params|await Promise\.all\(\[params/);
  });

  it('rebuilds the checkout through the parser and never reads the URL itself', () => {
    expect(read(join(ROOT, 'lib/checkout.ts'))).toMatch(/parseCheckout\(/);
    expect(page).toMatch(/checkoutFromRequest\(/);
    expect(stripComments(page)).not.toMatch(/searchParams\)?\.(?:a|n|m|r|d|c|t)\b/);
  });

  it('is kept out of search indexes and carries its own title and description', () => {
    expect(page).toMatch(/index: false/);
    expect(page).toMatch(/generateMetadata/);
    expect(page).toMatch(/openGraph/);
  });

  it('skips the account gate and the tab bar, and only for checkout routes', () => {
    const providers = stripComments(read(join(PAGES, 'providers.tsx')));
    expect(providers).toMatch(/isPublicPath\(pathname\)/);
    expect(providers).toMatch(/return <>\{children\}<\/>/);
    // The tab bar lives inside the gate, so a public route never draws it.
    expect(stripComments(read(join(COMPONENTS, 'AuthGate.tsx')))).toMatch(/<BottomNav \/>/);
    const routes = stripComments(read(join(ROOT, 'lib/public-routes.ts')));
    expect(routes).toMatch(/PUBLIC_PREFIXES = \['\/pay\/'\]/);
  });

  it('draws the pause control in its header whenever someone is signed in', () => {
    expect(page).toMatch(/<CheckoutHeader/);
    const header = stripComments(read(join(COMPONENTS, 'CheckoutHeader.tsx')));
    expect(header).toMatch(/account \? \(/);
    expect(header).toMatch(/<PauseControl\s*\/>/);
  });

  it('never prints an address, or any part of the code that stands for one', () => {
    for (const file of checkoutFiles) {
      const source = stripComments(read(file));
      expect(source, relative(ROOT, file)).not.toMatch(/\{[^}]*\.address\b[^}]*\}/);
      expect(source, relative(ROOT, file)).not.toMatch(/0x[0-9a-fA-F]{6,}/);
    }
    const checkout = stripComments(read(join(COMPONENTS, 'Checkout.tsx')));
    // The address reaches the page only through the on-ramp URL. The person is
    // named by the name and the username the directory has for them.
    expect(checkout).toMatch(/@\$\{checkout\.username\}/);
    expect(checkout).not.toMatch(/checkout\.code\b|codeLabel|Payment code/);
  });

  it('imports no fixtures', () => {
    for (const file of [...checkoutFiles, join(PAGES, 'receive/page.tsx'), join(PAGES, 'transfer/send/page.tsx')]) {
      expect(read(file), relative(ROOT, file)).not.toMatch(/fixtures|DEMO_|SNAPSHOT|store\.request/);
    }
  });

  it('shows amounts with the shared naira component, never as float math', () => {
    const checkout = stripComments(read(join(COMPONENTS, 'Checkout.tsx')));
    expect(checkout).toMatch(/<Figure value=\{kobo\(/);
    const lib = stripComments(read(join(ROOT, 'lib/checkout.ts')) + read(join(ROOT, 'lib/onramp.ts')));
    expect(lib).not.toMatch(/parseFloat|toFixed|Number\(\w*amount/i);
  });
});

describe('the bank-and-card option is honest about whether it exists', () => {
  const checkout = stripComments(read(join(COMPONENTS, 'Checkout.tsx')));

  it('is a disabled button, not a link, until a partner URL is configured', () => {
    expect(checkout).toMatch(/onrampUrl \? \(/);
    expect(checkout).toMatch(/<button[^>]*\n?\s*type="button"\s*\n\s*disabled/);
    expect(checkout).toMatch(/Bank and card payments open soon/);
    expect(checkout).toMatch(/href=\{onrampUrl\}/);
  });

  it('only ever links to the adapter’s answer, never a URL of its own', () => {
    expect(checkout).not.toMatch(/https?:\/\//);
    expect(stripComments(read(join(PAGES, 'pay/[code]/page.tsx')))).toMatch(/onrampUrl=\{onrampUrlFor\(checkout\)\}/);
  });

  it('reads its partner from one documented variable and names no secret', () => {
    const onramp = read(join(ROOT, 'lib/onramp.ts'));
    expect(onramp).toMatch(/NEXT_PUBLIC_ONRAMP_URL_TEMPLATE/);
    expect(onramp).toMatch(/Mercuryo/);
  });
});

describe('receive shows the pay link, not a fixture', () => {
  const receive = stripComments(read(join(PAGES, 'receive/page.tsx')));

  it('builds the link from the username and the runtime origin, once the username is theirs', () => {
    expect(receive).toMatch(/buildPayLink\(origin, \{ username \}\)/);
    expect(receive).toMatch(/claim === 'held' \? profile\?\.username : undefined/);
    expect(receive).toMatch(/window\.location\.origin/);
  });

  it('shows no code, long or short, and has none to copy', () => {
    expect(receive).not.toMatch(/\bpaymentCode\b|buildCheckoutLink|Copy code|Payment code/);
  });

  it('says what to do when there is no username to make a link from', () => {
    expect(receive).toMatch(/Choose a username to get paid/);
    expect(receive).toMatch(/href="\/me\?edit=1"/);
  });

  it('shares with the Web Share API when there is one, and confirms a copy', () => {
    expect(receive).toMatch(/navigator\.share/);
    expect(receive).toMatch(/'Copied'/);
  });

  it('renders a QR of the link and skeletons while it is not known yet', () => {
    expect(receive).toMatch(/<QrCode value=\{link\}/);
    expect(receive).toMatch(/<Skeleton/);
  });

  it('uses no spinner', () => {
    expect(receive).not.toMatch(/spinner|animate-spin/i);
  });
});

describe('sending pays a username, a number or a link, and never asks for an address', () => {
  const send = stripComments(read(join(PAGES, 'transfer/send/page.tsx')));

  it('reads the recipient through the one door every screen uses, and asks the directory who it is', () => {
    expect(send).toMatch(/readRecipient\(/);
    expect(send).toMatch(/findRecipient\(backend\.directory, /);
    expect(send).toMatch(/oneOffId\(/);
    expect(send).not.toMatch(/parseCheckout\(|encodePaymentCode/);
  });

  it('a pay link opened from its public page is looked up before the amount is asked', () => {
    expect(send).toMatch(/<OpeningStep \/>/);
    expect(send).toMatch(/params\.get\('to'\)/);
  });

  it('enters the amount on the keypad and confirms through a quote', () => {
    expect(send).toMatch(/<Keypad/);
    expect(send).not.toMatch(/type="number"|inputMode="(?:decimal|numeric)"/);
    const sheet = stripComments(read(join(COMPONENTS, 'ConfirmSendSheet.tsx')));
    expect(sheet).toMatch(/quoteSend\(/);
    expect(sheet).toMatch(/store\.send\(/);
  });

  it('never shows optimistic settlement — the receipt only renders from the store', () => {
    expect(send).toMatch(/store\.receipt\(receiptId\)/);
    const sheet = stripComments(read(join(COMPONENTS, 'ConfirmSendSheet.tsx')));
    // The settled state is set only after `store.send` has resolved.
    expect(sheet.indexOf('await store.send')).toBeLessThan(sheet.indexOf('setSettled(true)'));
  });

  it('no longer speaks of contacts', () => {
    const copy = [send, stripComments(read(join(PAGES, 'transfer/page.tsx')))]
      .flatMap((source) => userFacingCopy(source))
      // Text between `>` and `<` can be code (`=> x.contacts ? (`), which is not copy.
      .filter((text) => !/[(){}=?;]/.test(text) && /\bcontacts?\b/i.test(text));
    expect(copy).toEqual([]);
  });
});

describe('Grow shows only what is real', () => {
  // The same rule the phone app holds. Savings earn only where they are really
  // held somewhere that pays, so a rate or earnings may be shown only when read
  // from the position through `savingsEarning`, which answers nothing unless
  // the rate is real. Never a payout date, never a figure written into a page.
  const growFiles = ['grow/page.tsx', 'grow/savings/page.tsx'].map((path) => join(PAGES, path));

  it.each(growFiles)('%s never shows a payout date, and reads earnings only through savingsEarning', (file) => {
    const source = stripComments(read(file));
    expect(source).not.toMatch(/nextPayoutAt|payoutLabel|daysUntil/);
    expect(source).not.toMatch(/accruedMinor|ratePerYearBps/);
    expect(source).toMatch(/savingsEarning\(/);
  });

  it.each(growFiles)('%s writes no rate or percentage into the page itself, and promises no growth', (file) => {
    const copy = userFacingCopy(read(file)).join('\n');
    expect(copy).not.toMatch(/\b(yield|apy|apr|p\.a\.|annual|rate of return|returns on|guaranteed)\b/i);
    expect(copy).not.toMatch(/\d+(\.\d+)?\s*%/);
    expect(copy).not.toMatch(/watch it grow|What(&apos;|')s growing|Grow more money/i);
  });

  it.each(growFiles)('%s says plainly when savings earn nothing', (file) => {
    expect(read(file)).toMatch(/It doesn(&apos;|')t earn interest yet/);
  });

  it('the permanently-full meter is gone from savings', () => {
    for (const file of growFiles) expect(read(file)).not.toMatch(/<Meter|fraction=\{1\}/);
  });
});

describe('stocks are shown only as the market has them', () => {
  // The same rule the phone app holds. Until buying is open, Stocks is a place
  // to look: every name, price and figure is read live from this app's own
  // `/api/stocks` routes, which read the issuer and the exchange. Nothing is
  // written into a page, and nothing on these pages can buy.
  const files = [
    join(COMPONENTS, 'StockCatalogue.tsx'),
    join(COMPONENTS, 'StockPreview.tsx'),
    join(COMPONENTS, 'StockLogo.tsx'),
    join(PAGES, 'grow/stocks/page.tsx'),
    join(ROOT, 'lib/stocks.ts'),
  ];
  const catalogue = stripComments(read(join(COMPONENTS, 'StockCatalogue.tsx')));
  const preview = stripComments(read(join(COMPONENTS, 'StockPreview.tsx')));
  const listPage = stripComments(read(join(PAGES, 'grow/stocks/page.tsx')));
  const stockPage = stripComments(read(join(PAGES, 'grow/stocks/[symbol]/page.tsx')));

  it.each(files)('%s carries no ticker, price, percentage or address of its own', (file) => {
    const source = stripComments(read(file));
    expect(source).not.toMatch(/\b(AAPL|TSLA|NVDA|MSFT|GOOGL?|AMZN|META|NFLX|SPY|QQQ)\b/);
    expect(source).not.toMatch(/0x[0-9a-fA-F]{4,}|\baddress\b/);
    const copy = userFacingCopy(read(file)).join('\n');
    expect(copy).not.toMatch(/\d+(\.\d+)?\s*%/);
    expect(copy).not.toMatch(/[$₦]\s?\d/);
  });

  it('the list and each stock are read through the one live client', () => {
    expect(stripComments(read(join(ROOT, 'lib/stocks.ts')))).toMatch(/createStockMarketClient\(\{ baseUrl: '' \}\)/);
    expect(catalogue).toMatch(/useStockBrowse\(stockMarket,/);
    expect(preview).toMatch(/useStockDetail\(stockMarket,/);
    expect(listPage).toMatch(/<StockCatalogue \/>/);
    expect(stockPage).toMatch(/store\.stocksAvailable \? <StockTradePage \/> : <StockPreview symbol=\{symbol\} \/>/);
  });

  it('a figure the market did not give is left out, not filled in', () => {
    expect(preview).toMatch(/if \(detail\.volume !== undefined\)/);
    expect(preview).toMatch(/if \(detail\.marketCap\)/);
    expect(preview).toMatch(/\{line && month \? \(/);
    expect(preview).toMatch(/\{detail\.about \? \(/);
    expect(preview).toMatch(/store\.status === 'ready' \?/);
  });

  it('buying is shown and cannot be pressed, and nothing here moves money', () => {
    expect(preview).toMatch(/<button\s+type="button"\s+disabled\s+aria-disabled/);
    expect(preview).toMatch(/>Coming soon</);
    expect(preview).toMatch(/Nothing here can move your money yet/);
    for (const source of [catalogue, preview]) {
      expect(source).not.toMatch(/buyStock|sellStock|submitPayment|depositGrow|withdrawGrow/);
    }
  });

  it('loading is a skeleton, and a failed read says so and offers another try', () => {
    for (const source of [catalogue, preview]) {
      expect(source).toMatch(/Skeleton/);
      expect(source).not.toMatch(/animate-spin|Spinner/);
      expect(source).toMatch(/Nothing has changed/);
      expect(source).toMatch(/Try again/);
    }
  });
});

describe('the rest of the screens are written on paper too', () => {
  const pages = walk(PAGES).filter((file) => file.endsWith('.tsx'));

  it('a field is named by a label, never by a section heading', () => {
    for (const file of pages) {
      const source = stripComments(read(file));
      expect(source, file).not.toMatch(/font-display text-subhead[^"]*">[^<]*<\/(p|h2)>\s*<(input|select|textarea)\b/);
    }
  });

  it('every amount that stands alone is in the display face', () => {
    const amount = stripComments(read(join(COMPONENTS, 'Amount.tsx')));
    expect(amount).not.toMatch(/font-(strong|heavy)/);
  });

  it.each(['add-money/page.tsx', 'receive/page.tsx', 'grow/page.tsx', 'business/page.tsx'])(
    '%s rules its rows and draws no bordered box',
    (path) => {
      expect(stripComments(read(join(PAGES, path)))).not.toMatch(/rounded-card border border-line bg-card/);
    },
  );

  it('section names are in the display face on Business and Me', () => {
    expect(stripComments(read(join(PAGES, 'business/page.tsx')))).toMatch(/<h2 className="[^"]*font-display text-subhead text-ink">Services</);
    expect(stripComments(read(join(PAGES, 'me/page.tsx')))).toMatch(/<h2 className="[^"]*font-display text-subhead text-ink">\{children\}/);
  });
});

describe('a wide window is not a phone drawn on a desktop', () => {
  const nav = stripComments(read(join(COMPONENTS, 'BottomNav.tsx')));
  const gate = stripComments(read(join(COMPONENTS, 'AuthGate.tsx')));
  const home = stripComments(read(join(PAGES, 'page.tsx')));

  it('from 1024px the five places run along the top, with the mark beside them', () => {
    expect(nav).toMatch(/lg:top-0/);
    expect(nav).toMatch(/lg:bottom-auto/);
    expect(nav).toMatch(/<BrandGlyph/);
  });

  it('every page starts under that bar, by the same height', () => {
    const bar = /lg:h-\[(\d+)px\]/.exec(nav)?.[1];
    expect(bar).toBeDefined();
    expect(gate).toContain(`lg:pt-[${bar}px]`);
    expect(gate).toContain(`min-h-[calc(100dvh-${bar}px)]`);
  });

  it('home sets the account beside its activity instead of one narrow column', () => {
    expect(home).toMatch(/lg:max-w-\[\d+px\]/);
    expect(home).toMatch(/lg:grid lg:grid-cols-/);
  });

  it('the pause control is still in the page header, not only in the bar', () => {
    expect(nav).not.toMatch(/PauseControl/);
    expect(stripComments(read(join(COMPONENTS, 'Header.tsx')))).toMatch(/<PauseControl \/>/);
  });
});

describe('a long form keeps its button in reach', () => {
  it('the new invoice button rides above the tab bar, not under it', () => {
    const invoice = stripComments(read(join(PAGES, 'business/new-invoice/page.tsx')));
    const action = /<div className="sticky[^"]*">\s*<button[\s\S]*?Send invoice/.exec(invoice)?.[0] ?? '';
    expect(action).toMatch(/sticky bottom-\[92px\]/);
    expect(action).toMatch(/bg-paper/);
  });
});

describe('a name is not a spelling mistake', () => {
  it.each([
    ['components/AuthGate.tsx', 'id="full-name"'],
    ['app/me/page.tsx', 'id="profile-full-name"'],
    ['app/business/new-invoice/page.tsx', 'id="invoice-client"'],
    ['components/SaveRecipient.tsx', 'placeholder="Their name"'],
  ])('%s: the field for a name is not spell-checked', (path, anchor) => {
    const source = read(join(ROOT, path));
    const field = source.slice(source.lastIndexOf('<input', source.indexOf(anchor)), source.indexOf('/>', source.indexOf(anchor)));
    expect(field).toContain(anchor);
    expect(field).toMatch(/spellCheck=\{false\}/);
  });
});

describe('the terms and the privacy notice', () => {
  const page = stripComments(read(join(COMPONENTS, 'LegalPage.tsx')));

  it('are the shared words, not a second copy', () => {
    expect(stripComments(read(join(PAGES, 'legal/terms/page.tsx')))).toMatch(/<LegalPage document=\{TERMS\}/);
    expect(stripComments(read(join(PAGES, 'legal/privacy/page.tsx')))).toMatch(/<LegalPage document=\{PRIVACY\}/);
    expect(page).toMatch(/from '@entole\/core\/legal'/);
    expect(page).not.toMatch(/placeholder/i);
  });

  it('can be read before signing up, and are offered where someone agrees to them', () => {
    expect(stripComments(read(join(COMPONENTS, 'AuthGate.tsx')))).toMatch(/href="\/legal\/terms"[\s\S]*href="\/legal\/privacy"/);
    expect(stripComments(read(join(COMPONENTS, 'Landing.tsx')))).toMatch(/href="\/legal\/terms"[\s\S]*href="\/legal\/privacy"/);
  });

  it('keep the pause control for anyone signed in', () => {
    expect(page).toMatch(/<CheckoutHeader \/>/);
  });
});

describe('nothing is wider than a small phone', () => {
  const files = [...walk(PAGES), ...walk(COMPONENTS)].filter((file) => file.endsWith('.tsx'));

  // A bare `grid` sizes its one column to the widest thing inside it. On a
  // 360px phone that pushed the whole first page off the side of the screen.
  it('a grid that gains columns on a wide screen names its single column on a narrow one', () => {
    const loose: string[] = [];
    for (const file of files) {
      for (const match of read(file).matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const names = (match[1] ?? match[2] ?? '').split(/\s+/);
        const responsive = names.some((name) => /^(sm|md|lg|xl):grid-cols-/.test(name));
        if (names.includes('grid') && responsive && !names.some((name) => name.startsWith('grid-cols-'))) {
          loose.push(relative(ROOT, file));
        }
      }
    }
    expect(loose).toEqual([]);
  });

  it('the first page scales its example phone on a narrow screen, and its header link stays one label', () => {
    const landing = stripComments(read(join(COMPONENTS, 'Landing.tsx')));
    expect(landing).toMatch(/max-\[399px\]:\[zoom:0\.75\]/);
    // Smaller, not reworded: the way back in has one name everywhere.
    expect(landing).toMatch(/max-\[359px\]:text-note"\s*>\s*I already have an account/);
  });

  it('the pause control keeps its state, and stays in the header, when there is no room for the word', () => {
    const control = stripComments(read(join(COMPONENTS, 'PauseControl.tsx')));
    expect(control).toMatch(/<span className="min-\[360px\]:hidden">Off<\/span>/);
    expect(control).toMatch(/aria-label="The assistant is off\./);
    expect(control.match(/aria-label/g)?.length).toBe(2);
  });
});

describe('every movement of the person\'s own money is confirmed with the passkey', () => {
  const onchain = stripComments(read(join(ROOT, 'lib/onchain.ts')));
  const session = stripComments(read(join(ROOT, 'lib/session.ts')));
  const gateway = stripComments(read(join(ROOT, '../../packages/core/onchain-gateway.ts')));

  it('the gateway is given the browser\'s passkey prompt', () => {
    expect(onchain).toMatch(/const confirmed = await confirmWithPasskey\(\);\s*if \(!confirmed\.ok\) throw new MovementNotConfirmedError\(confirmed\.reason\);/);
    expect(onchain).toMatch(/createOnChainGateway\(\{\s*publicClient,\s*ownerWalletClient,\s*confirmMovement,/);
  });

  it('the browser is asked to verify the person, for this site, with the saved passkey', () => {
    expect(session).toMatch(/userVerification: 'required'/);
    expect(session).toMatch(/rpId: RP_ID/);
    expect(session).toMatch(/allowCredentials: \[\{ type: 'public-key' as const, id: base64UrlToBytes\(credential\.credentialId\) \}\]/);
  });

  it('a send, a bill, savings either way and a new allowance all pass through it; the assistant\'s run does not', () => {
    for (const kind of ['send', 'send-many', 'bill', 'save', 'take-out', 'allowance']) {
      expect(gateway, kind).toMatch(new RegExp(`await confirm\\(\\{ kind: '${kind}'`));
    }
    const submit = /async submitPayment\(input: SendInput\)[\s\S]*?await refreshRate\(\);/.exec(gateway)?.[0] ?? '';
    expect(submit).toMatch(/if \(!input\.allowanceId\) \{/);
    const assistant = /async function executeAsAssistant[\s\S]*?\n  }\n/.exec(gateway)?.[0] ?? '';
    expect(assistant).not.toMatch(/confirm\(/);
  });

  it('a screen does not ask a second time: the gateway is the one place', () => {
    for (const file of [...walk(PAGES), ...walk(COMPONENTS)].filter((path) => path.endsWith('.tsx'))) {
      expect(stripComments(read(file)), file).not.toMatch(/confirmWithPasskey\(/);
    }
  });
});

describe('the bar is a capsule round the capsules in it', () => {
  it('on a phone the tab bar and its active tab share one curve', () => {
    const nav = stripComments(read(join(COMPONENTS, 'BottomNav.tsx')));
    expect(nav).toMatch(/h-16 [^"]*rounded-pill bg-card/);
    expect(nav).toMatch(/h-\[52px\] [^`]*rounded-pill/);
  });
});

describe('a username is one person\'s, and it is how they are paid', () => {
  const gate = stripComments(read(join(COMPONENTS, 'AuthGate.tsx')));
  const me = stripComments(read(join(PAGES, 'me/page.tsx')));
  const claim = stripComments(read(join(ROOT, 'lib/username-claim.tsx')));
  const send = stripComments(read(join(PAGES, 'transfer/send/page.tsx')));
  const receive = stripComments(read(join(PAGES, 'receive/page.tsx')));
  const pay = stripComments(read(join(PAGES, 'pay/[code]/page.tsx')));
  const route = stripComments(read(join(ROOT, 'app/api/directory/route.ts')));
  const storage = stripComments(read(join(ROOT, 'lib/server/directory.ts')));

  it('the server gives a username to the first account that claims it, in one step', () => {
    expect(storage).toMatch(/db\.set\(usernameKey\(username\), address, \{ nx: true \}\)/);
    expect(route).toMatch(/if \(username && !\(await claimUsername\(username, claimAddress\)\)\) \{\s*return json\(\{ error: 'username_taken' \}, 409\);/);
    // Refused before anything about the claimant is written.
    expect(route.indexOf('claimUsername(username, claimAddress)')).toBeLessThan(route.indexOf('await saveRecord('));
  });

  it('sign-up asks as the name is typed and will not continue with one that is taken', () => {
    expect(gate).toMatch(/useUsernameCheck\('', username, returning\?\.owner\.address\)/);
    expect(gate).toMatch(/validateUsername\(username\) \?\? \(usernameTaken \? USERNAME_TAKEN : null\)/);
    expect(gate).toMatch(/usernameCheck !== 'checking'/);
  });

  it('every signed-in account claims its username once, and is told if someone else holds it', () => {
    expect(claim).toMatch(/backend\.directory\.claim\(\{[\s\S]*?username,\s*\}\)/);
    expect(claim).toMatch(/error\.code === 'username_taken'\) \{\s*setResult\(\{ record, claim: 'taken' \}\);/);
    expect(stripComments(read(join(ROOT, 'app/providers.tsx')))).toMatch(/<UsernameClaimProvider>\s*<Gate>/);
    expect(stripComments(read(join(PAGES, 'page.tsx')))).toMatch(/<UsernameTakenNotice \/>/);
  });

  it('editing a profile claims the new username first, and a refusal saves nothing', () => {
    const save = /async function saveProfile\(\)[\s\S]*?\n  }\n/.exec(me)?.[0] ?? '';
    expect(save.indexOf('backend.directory.claim(')).toBeGreaterThan(-1);
    expect(save.indexOf('backend.directory.claim(')).toBeLessThan(save.indexOf('storeProfile(next)'));
    expect(save).toMatch(/error\.code === 'username_taken'\) \{\s*setRefused\(username\);\s*setSaving\(false\);\s*return;/);
  });

  it('the send field takes a username or a number, and names the person from the directory', () => {
    expect(send).toMatch(/placeholder="@username or 0803 123 4567"/);
    expect(send).toMatch(/findRecipient\(backend\.directory, sought\)/);
    // The name comes from the directory, inside `findRecipient`; the page never takes one from the text.
    expect(read(join(ROOT, '../../packages/core/recipient.ts'))).toMatch(/payee: identity\.name/);
    expect(send).toMatch(/Nobody on Entole has \$\{formatHandle\(handle\)\} yet\./);
  });

  it('receive leads with the username and a link made from it, once the username is theirs', () => {
    expect(receive).toMatch(/const username = claim === 'held' \? profile\?\.username : undefined;/);
    expect(receive).toMatch(/buildPayLink\(origin, \{ username \}\)/);
    expect(receive).toMatch(/@\{username\}<\/p>/);
  });

  it('a pay link made from a username opens the same checkout, and one nobody holds is invalid', () => {
    expect(pay).toMatch(/if \(!text\.startsWith\('@'\)\) return null;/);
    expect(pay).toMatch(/getUsernameOwner\(handle\.username\)/);
    expect(pay).toMatch(/if \(!record\) return null;/);
    expect(pay).toMatch(/checkoutFromRequest\(encodePaymentCode\(record\.address\), \{ \.\.\.query, n: record\.name \}\)/);
  });
});

describe('an unanswered username claim is tried again', () => {
  it('each time the page comes back into view, until the directory has said yes or no', () => {
    const claim = stripComments(read(join(ROOT, 'lib/username-claim.tsx')));
    expect(claim).toMatch(/document\.addEventListener\('visibilitychange', onVisible\)/);
    expect(claim).toMatch(/!record \|\| answered\) return;/);
    expect(claim).toMatch(/\[address, username, displayName, record, backend, answered, returned\]/);
  });
});

describe('a payment the network refuses says so', () => {
  const action = stripComments(read(join(PAGES, 'assistant/action/page.tsx')));
  const gateway = stripComments(read(join(ROOT, '../../packages/core/onchain-gateway.ts')));

  it('the undo window stops counting, says it was not sent, and offers a way out', () => {
    expect(action).toMatch(/running=\{!stopped && !sending && !problem\}/);
    expect(action).toMatch(/'Not sent\. Nothing was taken\.'/);
    expect(action).toMatch(/\{problem \? 'Close' : 'Cancel this payment'\}/);
  });

  it('the reason comes from the network\'s own record, in the order the contract checks', () => {
    expect(gateway).toMatch(/if \(refused === true\) throw new Error\(await refusalReason\(id, amountToken\)\);/);
    const whole = /export function whyRefused[\s\S]*?\n}\n/.exec(gateway)?.[0] ?? '';
    // The body only: the parameter list names these too, in another order.
    const why = whole.slice(whole.indexOf('): string {'));
    const order = ['allowance.revoked', 'accountPaused', 'allowance.expiresAt', 'allowance.perRunMax', 'allowance.periodCap'].map((part) => why.indexOf(part));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('nobody is ever shown, or asked for, a code to be paid', () => {
  // People are paid by username or phone number. The long code an account is
  // kept as is storage: it never reaches a label, a field, a link or a share.
  it.each(sourceFiles.map((file) => [relative(ROOT, file), file] as const))('%s', (_name, file) => {
    const copy = userFacingCopy(read(file)).join('\n');
    expect(copy).not.toMatch(/\bpay(?:ment)? code\b|\bPAY-|\b(?:their|your|her|his) code\b|\bcode or (?:a )?link\b/i);
    const source = stripComments(read(file));
    expect(source).not.toMatch(/buildCheckoutLink|PaymentCodeText|entoleCode|profile\.code\b|\{paymentCode\}|oneOffCode/);
  });

  it('the pay page hands a payment on by username', () => {
    const page = stripComments(read(join(PAGES, 'pay/[code]/page.tsx')));
    expect(page).toMatch(/username: handle\.username/);
    expect(page).toMatch(/username: known\.username/);
    const lib = stripComments(read(join(ROOT, 'lib/checkout.ts')));
    expect(lib).not.toMatch(/codeLabel/);
  });
});
