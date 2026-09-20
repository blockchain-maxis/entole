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

  // A bare pause icon gave a new person no idea what they would be stopping.
  it('the pause control names the assistant instead of showing a bare icon', () => {
    const button = stripComments(read(join(ROOT, 'components/ui/PauseButton.tsx')));
    expect(button).toMatch(/Assistant · On/);
    expect(button).toMatch(/Assistant · Paused/);
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

describe('dark mode reaches every colour, not only some', () => {
  // NativeWind only treats `:root` and `.dark:root` as variable blocks on
  // native. A bare `.dark { ... }` compiles to an ordinary class nobody applies,
  // so className colours stayed light while JS-token colours (the tab bar) went
  // dark — icons and labels vanished in both schemes.
  const css = read(join(ROOT, 'global.css'));
  const theme = read(join(ROOT, 'lib/theme.tsx'));

  it('declares the dark palette on `.dark:root`, never a bare `.dark`', () => {
    expect(css).toMatch(/^\.dark:root \{/m);
    expect(css).not.toMatch(/^\.dark \{/m);
  });

  it('drives className and JS-token colours from one applied scheme', () => {
    expect(theme).toMatch(/vars\(themeCssVariables\(applied\)\)/);
    expect(theme).toMatch(/SchemeContext\.Provider value=\{applied\}/);
  });

  it('does not use NativeWind\'s colorScheme, which follows only the OS', () => {
    expect(theme).not.toMatch(/colorScheme\.set\(/);
    expect(theme).not.toMatch(/import \{[^}]*(colorScheme|useColorScheme)[^}]*\} from 'nativewind'/);
  });
});

describe('the bottom nav is legible and does not sit on a stray light rectangle', () => {
  const tabs = read(join(ROOT, 'app/(tabs)/_layout.tsx'));
  const tabIcon = read(join(COMPONENTS, 'ui/TabBarIcon.tsx'));
  const theme = read(join(ROOT, 'lib/theme.tsx'));

  it('paints the scenes with the themed paper colour, not the navigation theme', () => {
    expect(tabs).toMatch(/sceneStyle:\s*\{[^}]*backgroundColor:\s*themeColors\.paper/s);
  });

  it('takes the icon and label colour from the same themed token source', () => {
    expect(tabIcon).toMatch(/useThemeColors\(\)/);
    expect(tabIcon).toMatch(/const tint = focused \? colors\.ink : colors\.slate/);
    expect(tabIcon).toMatch(/<Icon [^>]*color=\{tint\}/);
    expect(tabIcon).toMatch(/style=\{\{ color: tint,/);
  });

  it('reveals a theme change from the tap instead of swapping it in place', () => {
    expect(theme).toMatch(/setPreference:\s*\(next: ThemePreference, origin\?: RevealOrigin\)/);
    expect(theme).toMatch(/borderRadius: D \/ 2/);
  });

  it('starts the reveal from the tap, on the UI thread, without waiting for a render', () => {
    // `play` sets shared values directly; the circle is always mounted, so
    // there is no state -> effect -> state chain before the first frame.
    expect(theme).toMatch(/cover\.set\(withTiming\(1/);
    expect(theme).toMatch(/play\(next === 'system' \? systemRef\.current : next, origin \?\? null\);\s*setPreferenceState\(next\)/);
    expect(theme).not.toMatch(/setReveal/);
  });

  it('draws the bar with plain Views, never the library bar whose container collapses', () => {
    const layout = read(join(ROOT, 'app/(tabs)/_layout.tsx'));
    const bar = read(join(COMPONENTS, 'ui/FloatingTabBar.tsx'));
    expect(layout).toMatch(/tabBar=\{renderTabBar\}/);
    expect(layout).not.toMatch(/tabBarStyle/);
    expect(bar).toMatch(/flexDirection: 'row'/);
    expect(bar).toMatch(/accessibilityRole="tab"/);
    // NativeWind's Pressable wrapper dropped a function `style`, packing the tabs left.
    expect(bar).not.toMatch(/style=\{\(\{\s*pressed/);
    expect(layout).toMatch(/lazy:\s*true/);
  });
});

describe('the header says who you are, not which app this is', () => {
  const header = read(join(COMPONENTS, 'ui/Header.tsx'));
  const chip = stripComments(read(join(COMPONENTS, 'ui/ProfileChip.tsx')));
  const profileHook = stripComments(read(join(ROOT, 'lib/profile.ts')));
  const home = read(join(ROOT, 'app/(tabs)/index.tsx'));
  const me = stripComments(read(join(ROOT, 'app/(tabs)/me.tsx')));

  it('renders the profile chip, not the brand mark, in the leading slot', () => {
    expect(header).toMatch(/leading === 'brand' \? <ProfileChip \/>/);
    expect(header).not.toMatch(/<BrandMark/);
  });

  it('lets a long name truncate instead of pushing the assistant chip away', () => {
    expect(chip).toMatch(/min-w-0 flex-1/);
    expect(chip).toMatch(/numberOfLines=\{1\}/);
    expect(header).toMatch(/<View className="ml-3 flex-none">/);
  });

  it('never renders an address, or a slice of one, in the chip or on Me', () => {
    for (const source of [chip, me]) {
      expect(source).not.toMatch(/\.address\b|shortAddress|truncateAddress|formatAddress|slice\(0,\s*6\)/);
      expect(source).not.toMatch(/entoleCode/);
    }
    // The code is derived in one place, from the address, and only the code leaves it.
    expect(profileHook).toMatch(/entoleCode\(account\.owner\.address\)/);
  });

  it('greets by the device clock with the full name, and no emoji', () => {
    expect(home).toMatch(/greetingFor\(\)/);
    expect(home).not.toMatch(/Good (morning|afternoon|evening)/);
    expect(home).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(home).not.toMatch(/split\(\/\\s\+\/\)\[0\]/);
    expect(home).not.toMatch(/'there'/);
  });

  it('shows no hardcoded place or corridor on Me', () => {
    expect(me).not.toMatch(/Lagos|Nigeria|NG ↔ US/);
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
    expect(enablers.map((file) => relative(ROOT, file))).toEqual(['app/assistant.tsx']);
  });

  it('the intro card leads to the approval screen instead of dismissing itself as "Got it"', () => {
    const intro = stripComments(read(join(ROOT, 'components/ui/PauseIntro.tsx')));
    expect(intro).toMatch(/Get started/);
    expect(intro).toMatch(/router\.push\('\/assistant'\)/);
    expect(intro).not.toMatch(/Got it/);
  });

  it('the header chip shows Off, and off leads to the approval screen rather than a pause', () => {
    const button = stripComments(read(join(ROOT, 'components/ui/PauseButton.tsx')));
    expect(button).toMatch(/Assistant · Off/);
    expect(button).toMatch(/'\/assistant'/);
  });

  it('the approval screen shows an action, not a toggle or a permission', () => {
    const screen = stripComments(read(join(ROOT, 'app/assistant.tsx')));
    expect(screen).not.toMatch(/<Switch/);
    expect(screen).toMatch(/Turn on the assistant/);
  });
});
