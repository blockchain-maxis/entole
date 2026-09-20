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

  it.each(pages)('%s renders the shared header', (file) => {
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
