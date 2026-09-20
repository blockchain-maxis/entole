import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

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
  const isCheckout = (file: string) => relative(PAGES, file).startsWith(join('pay', ''));

  it.each(pages.filter((file) => !isCheckout(file)))('%s renders the shared header', (file) => {
    expect(read(file)).toMatch(/<Header/);
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
    expect(enablers.map((file) => relative(ROOT, file))).toEqual(['app/assistant/page.tsx']);
  });

  it('the intro card leads to the approval screen instead of dismissing itself as "Got it"', () => {
    const intro = stripComments(read(join(ROOT, 'components/PauseIntro.tsx')));
    expect(intro).toMatch(/Get started/);
    expect(intro).toMatch(/href="\/assistant"/);
    expect(intro).not.toMatch(/Got it/);
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

  it('never prints an address — only the last group of the code, as a label', () => {
    for (const file of checkoutFiles) {
      const source = stripComments(read(file));
      expect(source, relative(ROOT, file)).not.toMatch(/\{[^}]*\.address\b[^}]*\}/);
      expect(source, relative(ROOT, file)).not.toMatch(/0x[0-9a-fA-F]{6,}/);
    }
    const checkout = stripComments(read(join(COMPONENTS, 'Checkout.tsx')));
    // The address reaches the page only through the on-ramp URL and the code label.
    expect(checkout).toMatch(/codeLabel\(checkout\)/);
    expect(checkout).not.toMatch(/\{checkout\.code\}/);
  });

  it('imports no fixtures', () => {
    for (const file of [...checkoutFiles, join(PAGES, 'receive/page.tsx'), join(PAGES, 'transfer/send/page.tsx')]) {
      expect(read(file), relative(ROOT, file)).not.toMatch(/fixtures|DEMO_|SNAPSHOT|store\.request/);
    }
  });

  it('shows amounts with the shared naira component, never as float math', () => {
    const checkout = stripComments(read(join(COMPONENTS, 'Checkout.tsx')));
    expect(checkout).toMatch(/<Amount value=\{kobo\(/);
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

describe('receive shows the checkout link, not a fixture', () => {
  const receive = stripComments(read(join(PAGES, 'receive/page.tsx')));

  it('builds the link from the payment code and the runtime origin', () => {
    expect(receive).toMatch(/buildCheckoutLink\(origin/);
    expect(receive).toMatch(/useBackend\(\)/);
    expect(receive).toMatch(/window\.location\.origin/);
  });

  it('shares with the Web Share API when there is one, and confirms a copy', () => {
    expect(receive).toMatch(/navigator\.share/);
    expect(receive).toMatch(/'Copied'/);
  });

  it('renders a QR of the link and skeletons while the code loads', () => {
    expect(receive).toMatch(/<QrCode value=\{link\}/);
    expect(receive).toMatch(/<Skeleton/);
  });

  it('uses no spinner', () => {
    expect(receive).not.toMatch(/spinner|animate-spin/i);
  });
});

describe('sending pays a code or link, and never asks for an address', () => {
  const send = stripComments(read(join(PAGES, 'transfer/send/page.tsx')));

  it('validates the recipient with the same parser the link uses', () => {
    expect(send).toMatch(/parseCheckout\(/);
    expect(send).toMatch(/oneOffId\(/);
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
