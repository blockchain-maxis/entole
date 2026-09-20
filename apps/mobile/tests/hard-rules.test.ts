import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The hard rules in CLAUDE.md are the product thesis, so they are checked here
 * rather than left to review. These are deliberately blunt: a rule that only
 * lives in a document is a rule that erodes.
 */

const ROOT = join(__dirname, '..');
const SCREENS = join(ROOT, 'app');
const COMPONENTS = join(ROOT, 'components');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.tsx') || path.endsWith('.ts') ? [path] : [];
  });
}

const sourceFiles = [...walk(SCREENS), ...walk(COMPONENTS)];

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
    ...body.matchAll(
      /(?:label|title|accessibilityLabel|accessibilityHint|placeholder)=(?:\{)?["'`]([^"'`]+)/g,
    ),
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

describe('the pause control is reachable from every screen header', () => {
  // Onboarding and the lock screen have no allowances to pause yet — there is
  // no signed-in account behind them — and the two sheets are presented over a
  // screen whose header already carries the control.
  const exempt = [
    'app/onboarding',
    'app/index.tsx',
    'app/lock.tsx',
    'app/rules/[id].tsx',
    'app/assistant-action.tsx',
  ];

  const screens = walk(SCREENS).filter((file) => {
    const path = relative(ROOT, file);
    if (exempt.some((prefix) => path.startsWith(prefix))) return false;
    return read(file).includes("from '@/components/ui/Screen'");
  });

  it('finds screens to check', () => {
    expect(screens.length).toBeGreaterThan(0);
  });

  it.each(screens)('%s renders the shared header', (file) => {
    expect(read(file)).toMatch(/<Header/);
  });

  // Rendering `<Header` alone proves nothing about the pause control — the
  // header has to carry it *by default*, so no screen can forget it.
  it('the shared header renders the pause control unless a screen opts out', () => {
    const header = read(join(ROOT, 'components/ui/Header.tsx'));
    expect(header).toMatch(/import \{ PauseButton \} from '\.\/PauseButton'/);
    expect(header).toMatch(/trailing === undefined \? <PauseButton \/> : trailing/);
  });

  it('only the pause screen itself opts out of the header pause control', () => {
    const optedOut = screens.filter((file) => /trailing=\{null\}/.test(read(file)));
    expect(optedOut.map((file) => relative(ROOT, file))).toEqual(['app/pause.tsx']);
  });
});

describe('money amounts never use the system keyboard', () => {
  const amountScreens = [
    'app/send/index.tsx',
    'app/rules/new.tsx',
    'app/onboarding/phone.tsx',
    'app/grow/savings.tsx',
    'app/grow/stock/[symbol].tsx',
    'app/business/pay-supplier.tsx',
    'app/bill/pay.tsx',
  ];

  it.each(amountScreens)('%s enters digits through the custom keypad', (path) => {
    const source = read(join(ROOT, path));
    expect(source).toMatch(/<Keypad/);
    expect(source).not.toMatch(/\bTextInput\b/);
  });
});

describe('assistant actions are visually distinct', () => {
  it('every list that can show one uses the assistant tint token', () => {
    const feed = read(join(ROOT, 'components/ui/ActivityRow.tsx'));
    expect(feed).toMatch(/bg-indigo-wash/);
    expect(feed).toMatch(/AssistantBadge/);
  });
});

describe('a signed-in session needs a live account, not only a fresh timestamp', () => {
  // The timestamp is on disk and survives the app closing; the signing account
  // is deliberately memory-only. Checking only the timestamp lets a cold start
  // render the tabs with nothing to sign with, so they load forever.
  const tabs = read(join(ROOT, 'app/(tabs)/_layout.tsx'));

  it('the tabs guard sends an account-less launch to the lock screen', () => {
    expect(tabs).toMatch(/!account \|\| !\(await sessionIsFresh\(\)\)/);
  });

  it('the guard does not stack another lock screen while one is already showing', () => {
    expect(tabs).toMatch(/lockScreen\.visible/);
  });
});

describe('a phone that is "onboarded" but has no passkey is not stranded on the lock screen', () => {
  // The lock screen can only confirm a passkey that exists. Trusting the
  // onboarded flag alone left a phone with the flag and no passkey stuck there
  // for good, with no way back to the screen that creates one.
  it('the entry route needs a saved passkey, not only the onboarded flag', () => {
    expect(read(join(ROOT, 'app/index.tsx'))).toMatch(/hasStoredCredential/);
  });

  it('the lock screen sends a passkey-less phone to setup instead of prompting', () => {
    const lock = read(join(ROOT, 'app/lock.tsx'));
    expect(lock).toMatch(/!\(await hasStoredCredential\(\)\)/);
    expect(lock).toMatch(/router\.replace\('\/onboarding'\)/);
  });
});
