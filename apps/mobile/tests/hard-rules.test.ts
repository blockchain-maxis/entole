import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { themeCssVariables } from '@entole/tokens';

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

/** Repo-relative path with forward slashes, so comparisons hold on Windows too. */
function rel(file: string): string {
  return relative(ROOT, file).split(sep).join('/');
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
    const path = rel(file);
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
    expect(optedOut.map((file) => rel(file))).toEqual(['app/pause.tsx']);
  });
});

describe('the allowance builder cannot be left doing nothing', () => {
  const builder = stripComments(read(join(ROOT, 'app/rules/new.tsx')));

  it('starts on a person who exists, never on a made-up id', () => {
    expect(builder).not.toMatch(/'c-mom'|'c-[a-z]+'/);
    expect(builder).toMatch(/picked \?\? store\.contacts\[0\]\?\.id/);
  });

  it('cannot be created without a person, and says where to get one', () => {
    expect(builder).toMatch(/disabled=\{!recipient \|\| perRun <= 0 \|\| limit < perRun\}/);
    expect(builder).toMatch(/label="Add a beneficiary"/);
  });

  it('gives each amount its own digits', () => {
    expect(builder).toMatch(/<AmountPad\s+key=\{slot\}/);
  });

  it('says so when saving fails', () => {
    const save = /async function save\(\)[\s\S]*?\n  }\n/.exec(builder)?.[0] ?? '';
    // And says why, when the reason is one a person can act on ("Not confirmed").
    expect(save).toMatch(/catch \(error\) \{\s*setProblem\(plainMessage\(error, "We couldn't save that allowance\./);
  });

  it('the person in the sentence is shown by their initials, not an empty disc', () => {
    expect(stripComments(read(join(ROOT, 'components/ui/Sentence.tsx')))).toMatch(/\{part\.avatar\.initials\}/);
  });
});

describe('home is written on paper: one figure, sentences, ruled rows', () => {
  const home = stripComments(read(join(ROOT, 'app/(tabs)/index.tsx')));

  it('the balance is the figure, in the display face, with no card around it', () => {
    expect(home).toMatch(/<Figure value=\{store\.balance\} \/>/);
    expect(home).not.toMatch(/height \* 0\.3|shadow-raised/);
    expect(stripComments(read(join(COMPONENTS, 'ui/Amount.tsx')))).toMatch(/<Text tabular className=\{`font-display /);
  });

  it('offers sending, adding and receiving once there is money, and never Business', () => {
    const row = /<Button label="Send"[\s\S]*?<\/View>/.exec(home)?.[0] ?? '';
    expect([...row.matchAll(/label="([^"]+)"/g)].map((match) => match[1])).toEqual(['Send', 'Add money', 'Receive']);
    expect(home).not.toMatch(/label="Business"/);
  });

  it('an allowance is a sentence in the assistant\'s blue, with what is left and the meter', () => {
    const row = stripComments(read(join(COMPONENTS, 'ui/AllowanceCard.tsx')));
    expect(row).toMatch(/font-display-plain text-prose text-indigo/);
    expect(row).toMatch(/cadenceWords\(allowance\.cadence\)/);
    expect(row).toMatch(/<Meter/);
    expect(row).not.toMatch(/border border-line bg-card/);
  });

  it('rules its own rows: the list has no boxes and no gaps standing in for them', () => {
    expect(home).not.toMatch(/ItemSeparatorComponent/);
    expect(home).toMatch(/ruled=\{Boolean\(previous\) && !byAssistant\(item\) && !byAssistant\(previous!\)\}/);
  });
});

describe('an allowance reads as its sentence, and is not revoked on one tap', () => {
  const sheet = stripComments(read(join(ROOT, 'app/rules/[id].tsx')));
  const action = stripComments(read(join(ROOT, 'app/assistant-action.tsx')));

  it('the sentence is set in the display face, in the builder and on the sheet', () => {
    expect(stripComments(read(join(ROOT, 'components/ui/Sentence.tsx')))).toMatch(/font-display-plain text-sentence text-ink/);
    expect(sheet).toMatch(/font-display-plain text-subhead text-indigo/);
  });

  it('what is left is the figure, with the payments made from it under it', () => {
    expect(sheet).toMatch(/<Figure value=\{allowance\.remainingMinor\} \/>/);
    expect(sheet).toMatch(/entry\.allowanceId === allowance\.id/);
  });

  it('revoking asks first, and says so when it fails', () => {
    expect(sheet).toMatch(/onPress=\{\(\) => setAsking\(true\)\}/);
    expect(sheet).toMatch(/Revoke this allowance\?/);
    expect(/async function revoke\(\)[\s\S]*?\n  }\n/.exec(sheet)?.[0]).toMatch(/catch \{/);
  });

  it('the undo window names the assistant, and stopping it is the strong button', () => {
    expect(action).toMatch(/The assistant is about to send/);
    expect(action).not.toMatch(/Entole (is sending|sent)/);
    expect(action).toMatch(/<Button label=\{problem \? 'Close' : 'Cancel this payment'\} disabled=\{sending\}/);
    expect(action).toMatch(/<Figure value=\{amount\} \/>/);
  });
});

describe('the logo is the Entole mark, the same one as the app icon', () => {
  // The first screens once showed an "E" on a tile, which was never the logo.
  const mark = read(join(ROOT, 'components/ui/BrandMark.tsx'));

  it('draws the open ring, the bar and the dot', () => {
    expect(mark).toContain('M50 16 A34 34 0 1 1 16 50');
    expect(mark).toContain('M4 50 H26');
    expect(mark).toMatch(/<Circle cx=\{50\} cy=\{50\} r=\{7\}/);
  });

  it.each(['app/onboarding/index.tsx', 'app/lock.tsx'])('%s shows the mark, not a letter on a tile', (path) => {
    const screen = stripComments(read(join(ROOT, path)));
    expect(screen).toMatch(/<BrandMark \/>/);
    expect(screen).not.toMatch(/>E<\/Text>/);
  });
});

describe('the one thing that turns is the Entole mark', () => {
  const loader = read(join(ROOT, 'components/ui/LogoLoader.tsx'));
  const intro = stripComments(read(join(ROOT, 'components/ui/Intro.tsx')));

  it('is the logo itself, its ring drawing round to the bar', () => {
    expect(loader).toContain('M50 16 A34 34 0 1 1 16 50');
    expect(loader).toContain('M4 50 H26');
    expect(loader).toMatch(/strokeDashoffset: RING \* \(1 - progress\.value\)/);
  });

  it('is still for someone who asked for less motion', () => {
    expect(loader).toMatch(/useReducedMotion\(\)/);
    expect(loader).toMatch(/if \(reduce\) \{\s+progress\.value = 1;/);
  });

  it('no system spinner is left anywhere: a busy button turns the mark', () => {
    for (const file of sourceFiles) {
      expect(stripComments(read(file)), rel(file)).not.toMatch(/ActivityIndicator/);
    }
    expect(stripComments(read(join(ROOT, 'components/ui/Button.tsx')))).toMatch(/<LogoLoader size=\{21\} color=\{markColor\}/);
  });

  it('opens the app once per launch, over the app as it loads, and gets out of the way', () => {
    expect(stripComments(read(join(ROOT, 'app/_layout.tsx')))).toMatch(/<ToastHost \/>\s*<Intro \/>/);
    expect(intro).toMatch(/<LogoLoader size=\{84\} once/);
    expect(intro).toMatch(/if \(stage === 'gone'\) return null;/);
    // Pinned over the whole screen, and above the tab bar, by a plain view.
    expect(intro).toMatch(/<View\s+style=\{styles\.over\}/);
    expect(intro).toMatch(/over: \{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 1000, elevation: 1000 \}/);
    // Laid out by class names and moved by entering and exiting, as the sheets
    // and toasts are. A list of styles ending in an animated one put the mark
    // in a corner on Android, twice.
    expect(intro).toMatch(/<Animated\.View className="flex-1 items-center justify-center bg-paper" exiting=\{FadeOut/);
    expect(intro).not.toMatch(/useAnimatedStyle|absoluteFill/);
    expect(intro).not.toMatch(/<Animated\.View[^>]*style=\{\[/);
    // It runs on a clock of its own and waits on nothing the app is doing.
    expect(intro).not.toMatch(/useStore|useAccount|fontsLoaded/);
  });
});

describe('the pause warning is for pausing', () => {
  it('resuming does not buzz like stopping everything', () => {
    const pause = stripComments(read(join(ROOT, 'app/pause.tsx')));
    expect(pause).toMatch(/if \(pausing\) void Haptics\.notificationAsync\(Haptics\.NotificationFeedbackType\.Warning\)/);
  });
});

describe('money amounts never use the system keyboard', () => {
  const amountScreens = [
    'app/send/index.tsx',
    'app/rules/new.tsx',
    'app/onboarding/phone.tsx',
    'app/grow/savings.tsx',
    'app/grow/stock/[symbol].tsx',
    // app/business/pay-supplier.tsx was removed: paying a supplier goes through the ordinary Send flow.
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

describe('two inks: black is the person, blue is the assistant', () => {
  // Blue used to be the button, link, selection and focus colour as well as
  // the assistant's, so it said nothing. It is now only ever the assistant.
  const ASSISTANT_SURFACES = [
    'app/(tabs)/index.tsx',
    'app/assistant-action.tsx',
    'app/assistant.tsx',
    'app/connections.tsx',
    'app/onboarding/index.tsx',
    'app/rules/[id].tsx',
    'components/ui/ActivityRow.tsx',
    'components/ui/AllowanceCard.tsx',
    'components/ui/AllowanceIntro.tsx',
    'components/ui/Badge.tsx',
    // The logo: a blue ring, the brand's own and not the assistant's.
    'components/ui/BrandMark.tsx',
    'components/ui/Countdown.tsx',
    // The logo again, drawing itself.
    'components/ui/LogoLoader.tsx',
    'components/ui/Meter.tsx',
    'components/ui/Toast.tsx',
  ];

  it('blue appears only where the assistant has acted or may act', () => {
    const blue = sourceFiles
      .filter((file) => /indigo/.test(stripComments(read(file))))
      .map(rel)
      .sort();
    expect(blue).toEqual(ASSISTANT_SURFACES);
  });

  it('a primary button is ink, as it is in the browser', () => {
    const button = stripComments(read(join(ROOT, 'components/ui/Button.tsx')));
    expect(button).toMatch(/primary: 'bg-ink /);
    expect(button).toMatch(/raised: 'bg-ink /);
  });

  it('a field in focus and the active tab are ink on a neutral ground', () => {
    expect(stripComments(read(join(ROOT, 'components/ui/Field.tsx')))).toMatch(/focused \? 'border-ink'/);
    expect(stripComments(read(join(ROOT, 'components/ui/TabBarIcon.tsx')))).toMatch(/focused \? colors\.press/);
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

describe('an account made on another device can be signed in to, not only made again', () => {
  // A new phone used to offer one thing, a new passkey, and so a new and empty
  // account every time. The passkey that made an account derives it again on
  // any device that can reach that passkey.
  const session = read(join(ROOT, 'lib/session.ts'));
  const signIn = /export async function signInWithExistingPasskey[\s\S]*?\n}\n/.exec(session)?.[0] ?? '';
  const welcome = read(join(ROOT, 'app/onboarding/index.tsx'));

  it('the welcome screen offers it beside starting new', () => {
    expect(welcome).toMatch(/label="I already have an account"/);
    expect(welcome).toMatch(/signInWithExistingPasskey\(\)/);
    expect(welcome).toMatch(/label="Continue with passkey"/);
  });

  it('signing in names no passkey and makes none', () => {
    expect(signIn).toMatch(/signInToOwnerAccount\(\{ rpId: RP_ID, webAuthnClient: reactNativeWebAuthnClient \}\)/);
    expect(signIn).not.toMatch(/createOwnerAccount|loadCredential/);
  });

  it('keeps the passkey it was given, so the next unlock asks for that one', () => {
    expect(signIn).toMatch(/storeCredential\(owner\.credential\)/);
  });

  it('asks a returning person their name once and lets them straight in', () => {
    const name = read(join(ROOT, 'app/onboarding/name.tsx'));
    expect(welcome).toMatch(/params: \{ returning: '1' \}/);
    expect(name).toMatch(/if \(returning\) \{\s+await markOnboarded\(\);\s+router\.replace\('\/\(tabs\)'\);/);
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

  // The stylesheet is a fallback the running app overrides, and it is still
  // written by hand. It has to say what the tokens say.
  it.each([
    ['light', /^:root \{([\s\S]*?)^\}/m],
    ['dark', /^\.dark:root \{([\s\S]*?)^\}/m],
  ] as const)('the %s block in the stylesheet matches the tokens exactly', (scheme, block) => {
    const body = block.exec(css)?.[1] ?? '';
    const written = Object.fromEntries(
      [...body.matchAll(/(--color-[a-z0-9-]+):\s*([0-9 ]+);/g)].map((match) => [match[1], match[2]!.trim()]),
    );
    expect(written).toEqual(themeCssVariables(scheme));
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
    // A person has one handle, their username. Nothing is derived from the address to stand in for it.
    expect(profileHook).not.toMatch(/entoleCode|\.address\b/);
  });

  it('greets by the device clock, with no emoji and no made-up or shortened name', () => {
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
    expect(enablers.map((file) => rel(file))).toEqual(['app/assistant.tsx']);
  });

  it('the introduction leads to the approval screen while the assistant is off, and cannot be waved away', () => {
    const intro = stripComments(read(join(ROOT, 'components/ui/AllowanceIntro.tsx')));
    expect(intro).toMatch(/label="Turn on the assistant"/);
    expect(intro).toMatch(/router\.push\('\/assistant'\)/);
    expect(intro).not.toMatch(/Got it|Not now|\.enable\(/);
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

describe('Home, Add money and Receive show the account, never a fixture', () => {
  const home = stripComments(read(join(ROOT, 'app/(tabs)/index.tsx')));
  const addMoney = stripComments(read(join(ROOT, 'app/add-money.tsx')));
  const receive = stripComments(read(join(ROOT, 'app/receive.tsx')));
  const paymentCode = stripComments(read(join(COMPONENTS, 'ui/PaymentCode.tsx')));
  const built = { home, addMoney, receive, paymentCode };

  it.each(Object.entries(built))('%s imports no fixture, demo rate or demo gateway', (_name, source) => {
    expect(source).not.toMatch(/DEMO_RATE|fixtures|demoGateway/);
  });

  it('never renders an address, or a slice of one', () => {
    for (const source of Object.values(built)) {
      expect(source).not.toMatch(/shortAddress|truncateAddress|formatAddress|slice\(0,\s*6\)/);
    }
    // The only place the address is read is the argument of the request for test money.
    for (const source of [home, receive, paymentCode]) expect(source).not.toMatch(/\.address\b/);
    const reads = addMoney.match(/[\w.?]*\.address\b/g) ?? [];
    expect(reads).toEqual(['account?.owner.viemAccount.address']);
    expect(addMoney).toMatch(/relay\.requestFunds\(address\)/);
  });

  it('Home has no fake Deposit — the action is Add money, and it leads to the real screen', () => {
    expect(home).not.toMatch(/Deposit/);
    expect(home).toMatch(/label="Add money"/);
    expect(home).toMatch(/router\.push\('\/add-money'\)/);
    // First run offers Receive (a link), not "Add a beneficiary": saved people are optional.
    expect(home).toMatch(/router\.push\('\/receive'\)/);
  });

  it('Home says so when the rate cannot be reached, and Retry re-reads instead of leaving a blank screen', () => {
    expect(home).toMatch(/store\.status === 'failed'/);
    expect(home).toMatch(/We can’t reach the exchange rate/);
    expect(home).toMatch(/label=\{retrying \? 'Trying again' : 'Retry'\}/);
    expect(home).toMatch(/await refresh\(\)/);
  });

  it('Home pulls to refresh, and an empty account gets a first-run block, not invented rows', () => {
    expect(home).toMatch(/onRefresh=\{\(\) => void pullToRefresh\(\)\}/);
    expect(home).toMatch(/store\.balance === 0 && store\.activity\.length === 0/);
    expect(home).toMatch(/Payments you send and receive will show up here/);
  });

  it('an empty Allowances section only offers set-up once the assistant is on', () => {
    expect(home).toMatch(/hasAllowances \? \([\s\S]*?\) : \(\s*<AllowanceIntro \/>/);
    const intro = stripComments(read(join(COMPONENTS, 'ui/AllowanceIntro.tsx')));
    expect(intro).toMatch(/assistant\.enabled \?[\s\S]*?router\.push\('\/rules\/new'\)[\s\S]*?router\.push\('\/assistant'\)/);
  });

  it('Add money explains it is test money and waits for the real balance to move', () => {
    expect(addMoney).toMatch(/Add test money to try Entole\. It’s not real money\./);
    expect(addMoney).toMatch(/label="Add test money"/);
    // Pending is a labelled state, and completion is the balance rising — never a guess.
    expect(addMoney).toMatch(/label="Adding money…"/);
    expect(addMoney).toMatch(/store\.balance <= startBalance\.current/);
    expect(addMoney).toMatch(/await refresh\(\)/);
    expect(addMoney).toMatch(/POLL_EVERY_MS = 1500/);
    expect(addMoney).toMatch(/POLL_FOR_MS = 20_000/);
    expect(addMoney).not.toMatch(/balance:\s*store\.balance\s*\+/);
  });

  it('Add money shows the sponsor\'s own plain-language failure and never a raw error', () => {
    expect(addMoney).toMatch(/error instanceof RelayError/);
    expect(addMoney).toMatch(/error\.message/);
    expect(addMoney).not.toMatch(/String\(error\)|error\.stack|JSON\.stringify\(error/);
  });

  it('credits the live rate feed where the rate is shown', () => {
    expect(addMoney).toMatch(/Rates by Exchange Rate API/);
    expect(addMoney).toMatch(/https:\/\/www\.exchangerate-api\.com/);
  });

  // Receive is the person's username: the pay link made from it, as a QR, and
  // the username itself. The long code that used to sit underneath is gone.
  it('Receive shows the pay link made from the username as a QR, and never a code', () => {
    expect(receive).toMatch(/usePayUsername\(\)/);
    expect(receive).toMatch(/buildPayLink\(CHECKOUT_BASE/);
    expect(receive).toMatch(/<PaymentCode value=\{link\}/);
    expect(receive).toMatch(/Your username/);
    expect(receive).not.toMatch(/\bpaymentCode\b|PaymentCodeText|buildCheckoutLink|Your code/);
    expect(paymentCode).not.toMatch(/PaymentCodeText/);
    expect(receive).not.toMatch(/store\.request|useStore/);
  });

  it('Receive waits for the directory to say the username is theirs, and says so when it has not', () => {
    expect(receive).toMatch(/mine\.state === 'held'/);
    expect(receive).toMatch(/mine\.state === 'unconfirmed'/);
    expect(receive).toMatch(/label="Try again"/);
  });

  it('Receive copes with no link yet by showing a skeleton and a disabled Copy link', () => {
    expect(receive).toMatch(/<Skeleton/);
    expect(receive).toMatch(/disabled=\{!link\}/);
  });

  it('the QR encodes exactly what it is given (the link), never an address', () => {
    expect(paymentCode).toMatch(/<QRCode value=\{value\}/);
  });

  it('no route still points at a removed Deposit screen', () => {
    for (const file of sourceFiles) {
      expect(stripComments(read(file)), relative(ROOT, file)).not.toMatch(/['"`]\/deposit['"`]/);
    }
  });
});

describe('beneficiaries, and a send that shows only what is real', () => {
  // Every screen a person can send money from, plus the shared review sheet.
  const sendFlow = [
    'app/send/index.tsx',
    'app/send/pick.tsx',
    'app/send/receipt.tsx',
    'app/(tabs)/transfer.tsx',
    // app/abroad was folded into Send (it only grouped saved people by country).
    'app/send/scan.tsx',
    'app/send/bank.tsx',
    'app/onboarding/first-payment.tsx',
    // (pay-supplier.tsx removed: a supplier is paid through /send/pick like anyone else.)
    'components/ui/ConfirmSendSheet.tsx',
  ];
  const beneficiaryScreens = [
    'app/beneficiaries/index.tsx',
    'app/beneficiaries/new.tsx',
    'app/beneficiaries/[id].tsx',
    'components/ui/BeneficiaryForm.tsx',
    'components/ui/CountryPicker.tsx',
  ];
  const touched = [...sendFlow, ...beneficiaryScreens];

  it.each(sendFlow)('%s shows no fee constant, arrival time, fixture or address book', (path) => {
    const source = stripComments(read(join(ROOT, path)));
    expect(source).not.toMatch(/FEE_MINOR|ESTIMATED_ARRIVAL_SECONDS|arrivalEstimate/);
    expect(source).not.toMatch(/fixtures|address-book|corridorsFor/);
  });

  // The word was replaced by "beneficiary" in everything a person reads. Code
  // identifiers (`contact`, `ContactRow`) are internal and stay.
  it.each(touched)('%s no longer says "contact" in what a person reads', (path) => {
    // `=>` would read as the end of a tag, and swallow code as "copy".
    const offences = userFacingCopy(read(join(ROOT, path)).replace(/=>/g, '='))
      // `${contact.name}` inside a label is an identifier, not a word a person reads.
      .map((copy) => copy.replace(/\$\{[^}]*\}/g, ''))
      // The JSX-text scan also catches stretches of code between two tags.
      .filter((copy) => !/^\)|\.contacts?\b|===|\bstore\./.test(copy))
      .filter((copy) => /\bcontacts?\b/i.test(copy));
    expect(offences, `${path}\n${offences.join('\n')}`).toEqual([]);
  });

  it.each(sendFlow.filter((path) => !path.endsWith('receipt.tsx')))('%s does not hardcode a country or corridor', (path) => {
    expect(stripComments(read(join(ROOT, path)))).not.toMatch(/Nigeria|Lagos|→/);
  });

  it('fees appear on the review sheet, from a real quote, not on the amount screens', () => {
    const sheet = stripComments(read(join(ROOT, 'components/ui/ConfirmSendSheet.tsx')));
    expect(sheet).toMatch(/quoteSend/);
    for (const label of ['They receive', 'Fee', 'Total from you', 'Confirm and send']) {
      expect(sheet).toContain(label);
    }
    // A send that has not settled is pending, not done: success is the receipt.
    expect(sheet).toMatch(/await store\.send\(/);
    expect(sheet).toMatch(/router\.replace\(\{ pathname: '\/send\/receipt'/);

    for (const path of ['app/send/index.tsx']) {
      const amountScreen = stripComments(read(join(ROOT, path)));
      expect(amountScreen).toMatch(/<ConfirmSendSheet/);
      expect(amountScreen).not.toMatch(/store\.send\(/);
      expect(amountScreen).not.toMatch(/>\s*Fee\b|`Fee /);
    }
  });

  it('the only places a person-initiated payment is sent are the review sheet and the payroll run', () => {
    const senders = sourceFiles.filter((file) => /\bstore\.send\(/.test(stripComments(read(file))));
    // The assistant's own payment runs through its undo countdown (`runProposal`) instead.
    // Payroll (added with the Business rebuild) pays a whole team from one confirmation, one person at a time.
    expect(senders.map((file) => rel(file))).toEqual([
      'app/business/payroll/run.tsx',
      'components/ui/ConfirmSendSheet.tsx',
    ]);
  });

  it('adding a beneficiary asks for a username or number and never renders an address', () => {
    for (const path of beneficiaryScreens) {
      const source = stripComments(read(join(ROOT, path)));
      // The address may travel in the record; it may not reach a screen.
      expect(source, path).not.toMatch(/\{[^{}]*\baddress\b[^{}]*\}\s*<\/Text>|<Text[^>]*>\s*\{[^{}]*\baddress\b/);
      expect(source, path).not.toMatch(/shortAddress|truncateAddress|formatAddress|slice\(0,\s*6\)/);
    }
    const add = stripComments(read(join(ROOT, 'app/beneficiaries/new.tsx')));
    expect(add).toMatch(/readRecipient\(/);
    expect(add).toMatch(/findRecipient\(directory, sought\)/);
    expect(add).not.toMatch(/decodePaymentCode|PAY-/);
    expect(add).toMatch(/source\.saveBeneficiary\(/);
    expect(add).toMatch(/store\.refresh\(\)/);
    expect(add).toMatch(/That doesn't look like a username or a phone number/);
    expect(add).toMatch(/That's you\. Add someone else\./);
    expect(add).toMatch(/already have/);
    // Someone just paid is handed over by id, so nothing of them is typed or shown.
    expect(add).toMatch(/oneOffAddress\(recipient\)/);
    expect(add).not.toMatch(/CameraView|expo-camera|BarcodeScanner/);
  });

  it('bank details are optional and honest that nothing uses them yet', () => {
    const form = stripComments(read(join(ROOT, 'components/ui/BeneficiaryForm.tsx')));
    expect(form).toMatch(/Bank details/);
    expect(form).toMatch(/Saved for when bank payouts open/);
  });

  it('the amount screens explain a payment that is too small, too large or unaffordable', () => {
    const rules = read(join(ROOT, 'lib/send.ts'));
    expect(rules).toMatch(/The smallest payment is/);
    expect(rules).toMatch(/The largest payment is/);
    expect(rules).toMatch(/more than your balance/);
    for (const path of ['app/send/index.tsx']) {
      expect(read(join(ROOT, path))).toMatch(/Add money first/);
    }
  });

  it('Me leads to the beneficiaries, and the list can remove one behind a sheet', () => {
    expect(read(join(ROOT, 'app/(tabs)/me.tsx'))).toMatch(/router\.push\('\/beneficiaries'\)/);
    const edit = stripComments(read(join(ROOT, 'app/beneficiaries/[id].tsx')));
    expect(edit).toMatch(/<Sheet /);
    expect(edit).toMatch(/source\.removeBeneficiary\(/);
  });
});

describe('sending works without a saved beneficiary', () => {
  // The separate "Send to a payment code" screen (app/send/code.tsx) is gone:
  // the recipient step itself takes a code or link, so the old assertions about
  // that screen were replaced by the ones below.
  const pick = stripComments(read(join(ROOT, 'app/send/pick.tsx')));
  const receipt = stripComments(read(join(ROOT, 'app/send/receipt.tsx')));

  it('there is no separate payment-code screen any more', () => {
    expect(existsSync(join(ROOT, 'app/send/code.tsx'))).toBe(false);
    for (const file of sourceFiles) {
      expect(stripComments(read(file)), relative(ROOT, file)).not.toMatch(/['"`]\/send\/code['"`]|Send to a payment code/);
    }
  });

  it('after a one-off payment the receipt offers to save the person', () => {
    expect(receipt).toMatch(/isOneOffId\(receipt\.contactId\)/);
    expect(receipt).toMatch(/Save as a beneficiary/);
  });

  it('the recipient step is one field for a username, a number or a link, with Paste and Scan', () => {
    expect(pick).toMatch(/Who are you sending to\?/);
    expect(pick).toMatch(/readRecipient\(text\)/);
    expect(pick).not.toMatch(/parseCheckout\(/);
    expect(pick).toMatch(/That doesn't look like a username, a phone number or a pay link\./);
    expect(pick).toMatch(/Clipboard\.getStringAsync\(\)/);
    expect(pick).toMatch(/>Paste</);
    expect(pick).toMatch(/pathname: '\/send\/scan'/);
    expect(pick).toMatch(/Scan their QR code/);
    // A link's letters are case-sensitive; forcing capitals would break the link.
    expect(pick).not.toMatch(/autoCapitalize="characters"/);
  });
});

describe('Grow shows only what is real', () => {
  // Savings earn only where they are really held somewhere that pays (decided
  // 10 October 2026: on the main network that is a lending market). So Grow may
  // show a rate and earnings, but only ones read from the position through
  // `savingsEarning`, which answers nothing unless the rate is real. It may
  // never show a payout date, a figure written into the screen, a ticker or a
  // holding that did not come from the store.
  const growFiles = [
    'app/(tabs)/grow.tsx',
    'app/grow/savings.tsx',
    'app/grow/stocks.tsx',
    'app/grow/stock/[symbol].tsx',
    'components/ui/SavingsSheet.tsx',
    'components/ui/HoldingRow.tsx',
    'components/ui/SplitBar.tsx',
    'lib/savings.ts',
  ];
  const growSource = growFiles.map((path) => [path, stripComments(read(join(ROOT, path)))] as const);
  const hub = stripComments(read(join(ROOT, 'app/(tabs)/grow.tsx')));
  const savings = stripComments(read(join(ROOT, 'app/grow/savings.tsx')));
  const sheet = stripComments(read(join(ROOT, 'components/ui/SavingsSheet.tsx')));
  const stocks = stripComments(read(join(ROOT, 'app/grow/stocks.tsx')));
  const trade = stripComments(read(join(ROOT, 'app/grow/stock/[symbol].tsx')));

  it.each(growSource)('%s never shows a payout date, and reads earnings only through savingsEarning', (_path, source) => {
    expect(source).not.toMatch(/nextPayoutAt|payoutLabel|daysUntil/);
    // The raw fields are not read here: only the helper that refuses without a real rate.
    expect(source).not.toMatch(/accruedMinor|ratePerYearBps/);
    if (/earned so far|a year/.test(source)) expect(source).toMatch(/savingsEarning\(/);
  });

  it.each(growSource)('%s writes no rate or percentage into the screen itself', (_path, source) => {
    const copy = userFacingCopy(source).join('\n');
    expect(copy).not.toMatch(/\b(yield|apy|apr|p\.a\.|annual|rate of return|returns on|guaranteed)\b/i);
    expect(copy).not.toMatch(/\d+(\.\d+)?\s*%/);
  });

  it('a rate or earnings line only appears beside the plain "earns nothing yet" line it replaces', () => {
    for (const source of [hub, sheet]) {
      expect(source).toMatch(/earning \? \(/);
      expect(source).toMatch(/It doesn&apos;t earn interest yet/);
    }
  });

  it.each(growSource)('%s carries no demo ticker, price or holding', (_path, source) => {
    expect(source).not.toMatch(/\b(AAPL|TSLA|NVDA|MSFT|GOOGL?|AMZN|META|NFLX)\b/);
  });

  it.each(growSource)('%s renders no address', (_path, source) => {
    expect(source).not.toMatch(/0x[0-9a-fA-F]{4,}|\baddress\b/);
  });

  it('the permanently-full meter is gone from the Grow area', () => {
    for (const [, source] of growSource) expect(source).not.toMatch(/<Meter|fraction=\{1\}/);
  });

  it('Savings moves money only through the store, and only through the review sheet', () => {
    expect(sheet).toMatch(/store\.depositGrow\(/);
    expect(sheet).toMatch(/store\.withdrawGrow\(/);
    expect(sheet).toMatch(/<Sheet\b/);
    expect(sheet).not.toMatch(/ConfirmSendSheet/);
    expect(savings).toMatch(/<SavingsSheet/);
    expect(savings).not.toMatch(/depositGrow|withdrawGrow/);
  });

  it('a savings change is a real pending state, then the real balance, never an optimistic one', () => {
    expect(sheet).toMatch(/Waiting for it to settle/);
    expect(sheet).toMatch(/locked=\{waiting\}/);
    expect(sheet).toMatch(/store\.refresh\(\)/);
    expect(sheet).not.toMatch(/setBalance|optimistic/i);
  });

  it('savings has no fee line and refuses amounts outside what is real', () => {
    expect(sheet).not.toMatch(/label="Fee"/);
    const rules = stripComments(read(join(ROOT, 'lib/savings.ts')));
    expect(rules).toMatch(/smallestSavingsAmount/);
    expect(rules).toMatch(/which is \$0\.01/);
    expect(rules).toMatch(/you can spend/);
    expect(rules).toMatch(/in savings/);
  });

  it('the hub states plainly that savings does not earn interest yet', () => {
    expect(hub).toMatch(/It doesn&apos;t earn interest yet/);
    expect(hub).toMatch(/Add to savings/);
    expect(hub).toMatch(/Take out/);
  });

  it('the hub says savings is unavailable when there is no position', () => {
    expect(hub).toMatch(/Savings isn&apos;t available yet/);
    expect(savings).toMatch(/Savings isn&apos;t available yet/);
  });

  it('the hub draws a bar only when both amounts are real, and has loading and failed states', () => {
    expect(hub).toMatch(/share !== null/);
    expect(hub).toMatch(/<Skeleton/);
    expect(hub).toMatch(/<LoadFailed/);
    expect(hub).not.toMatch(/ActivityIndicator/);
  });

  it('Earn is one calm sentence and not a button', () => {
    const earn = hub.slice(hub.indexOf('>Earn<') - 200);
    expect(earn).toMatch(/Interest on savings is planned for when Entole goes live/);
    expect(hub.slice(hub.indexOf('>Earn<'))).not.toMatch(/<Button/);
  });

  it('until a broker is connected, stocks can be looked at and not bought', () => {
    for (const source of [hub, stocks, trade]) expect(source).toMatch(/stocksAvailable/);
    expect(hub).toMatch(/Buying opens soon/);
    expect(hub).toMatch(/router\.push\('\/grow\/stocks'\)/);
    expect(stocks).toMatch(/Buying opens soon/);
    expect(stocks).toMatch(/<StockCatalogue/);
    expect(trade).toMatch(/if \(!stocksAvailable\) \{[\s\S]*?<StockPreview symbol=\{symbol\} \/>/);
  });

  it('stocks show skeletons while loading and surface the error message inline', () => {
    expect(stocks).toMatch(/RowSkeleton/);
    expect(stocks).toMatch(/plainMessage\(error/);
    expect(trade).toMatch(/<Skeleton/);
    expect(trade).toMatch(/plainMessage\(error/);
  });
});

describe('stocks are shown only as the market has them', () => {
  // Decided 10 October 2026: until buying is open, Stocks is a place to look.
  // Every name, price and figure is read live from the server, which reads the
  // issuer and the exchange. Nothing is written into the app, and nothing on
  // these screens can buy.
  const files = [
    'components/ui/StockCatalogue.tsx',
    'components/ui/StockPreview.tsx',
    'components/ui/StockLogo.tsx',
    'lib/stocks.ts',
  ];
  const sources = files.map((path) => [path, stripComments(read(join(ROOT, path)))] as const);
  const catalogue = stripComments(read(join(ROOT, 'components/ui/StockCatalogue.tsx')));
  const preview = stripComments(read(join(ROOT, 'components/ui/StockPreview.tsx')));
  const client = stripComments(read(join(ROOT, 'lib/stocks.ts')));

  it.each(sources)('%s carries no ticker, price, percentage or address of its own', (_path, source) => {
    expect(source).not.toMatch(/\b(AAPL|TSLA|NVDA|MSFT|GOOGL?|AMZN|META|NFLX|SPY|QQQ)\b/);
    expect(source).not.toMatch(/0x[0-9a-fA-F]{4,}|\baddress\b/);
    const copy = userFacingCopy(source).join('\n');
    expect(copy).not.toMatch(/\d+(\.\d+)?\s*%/);
    expect(copy).not.toMatch(/[$₦]\s?\d/);
  });

  it('the list and each stock are read through the one live client', () => {
    expect(client).toMatch(/createStockMarketClient\(\{ baseUrl: API_BASE \}\)/);
    expect(catalogue).toMatch(/useStockBrowse\(stockMarket,/);
    expect(preview).toMatch(/useStockDetail\(stockMarket,/);
  });

  it('a figure the market did not give is left out, not filled in', () => {
    expect(preview).toMatch(/if \(detail\.volume !== undefined\)/);
    expect(preview).toMatch(/if \(detail\.marketCap\)/);
    expect(preview).toMatch(/\{month \? \(/);
    expect(preview).toMatch(/\{detail\.about \? \(/);
    expect(preview).toMatch(/store\.status === 'ready' \?/);
  });

  it('buying is shown and cannot be pressed, and nothing here moves money', () => {
    expect(preview).toMatch(/accessibilityState=\{\{ disabled: true \}\}/);
    expect(preview).toMatch(/>Coming soon</);
    expect(preview).toMatch(/Nothing here can move your money yet/);
    for (const [, source] of sources) {
      expect(source).not.toMatch(/buyStock|sellStock|submitPayment|depositGrow|withdrawGrow/);
    }
  });

  it('loading is a skeleton, and a failed read says so and offers another try', () => {
    for (const source of [catalogue, preview]) {
      expect(source).toMatch(/Skeleton/);
      expect(source).not.toMatch(/ActivityIndicator/);
      expect(source).toMatch(/Nothing has changed/);
      expect(source).toMatch(/label="Try again"/);
    }
  });
});

describe('sending is one simple step: a username, a number or a link, typed, scanned or pasted', () => {
  const scan = stripComments(read(join(ROOT, 'app/send/scan.tsx')));
  const bank = stripComments(read(join(ROOT, 'app/send/bank.tsx')));
  const send = stripComments(read(join(ROOT, 'app/send/index.tsx')));
  const home = stripComments(read(join(ROOT, 'app/(tabs)/index.tsx')));
  const pay = stripComments(read(join(ROOT, 'app/(tabs)/transfer.tsx')));
  const recipient = stripComments(read(join(ROOT, 'lib/recipient.ts')));

  it.each([
    'app/send/index.tsx',
    'app/send/pick.tsx',
    'app/send/scan.tsx',
    'app/send/bank.tsx',
    'app/send/receipt.tsx',
    'app/onboarding/first-payment.tsx',
    'app/(tabs)/index.tsx',
    'app/(tabs)/transfer.tsx',
  ])('%s never asks for a beneficiary to be added before paying', (path) => {
    const copy = userFacingCopy(read(join(ROOT, path))).join('\n');
    expect(copy).not.toMatch(/Add a beneficiary|No beneficiaries yet/);
    expect(stripComments(read(join(ROOT, path)))).not.toMatch(/router\.push\('\/beneficiaries\/new'\)/);
  });

  it('the recipient step passes a link’s amount and any note through to the amount screen and the review sheet', () => {
    expect(recipient).toMatch(/readRecipient\(/);
    expect(recipient).toMatch(/findRecipient\(backend\.directory, sought\)/);
    expect(recipient).toMatch(/oneOffId\(/);
    expect(recipient).toMatch(/found\.currency === 'NGN'/);
    expect(send).toMatch(/entryFromParam\(params\.amount\)/);
    expect(send).toMatch(/cleanNote\(params\.note\)/);
    expect(send).toMatch(/defaultNote/);
    // The review sheet takes the note as its initial value.
    expect(read(join(COMPONENTS, 'ui/ConfirmSendSheet.tsx'))).toMatch(/useState\(defaultNote \?\? ''\)/);
  });

  it('the scanner guards the camera import so a build without it never crashes', () => {
    expect(scan).toMatch(/try \{[\s\S]*?require\('expo-camera'\)[\s\S]*?\} catch \{/);
    // No top-level static import of the native module anywhere in the screen.
    expect(scan).not.toMatch(/^import [^\n]*from 'expo-camera'/m);
    expect(scan).toMatch(/Scanning needs the updated app/);
    expect(scan).toMatch(/Paste/);
    expect(scan).toMatch(/getDerivedStateFromError/);
  });

  it('the scanner reads QR codes only, asks plainly, and copes with a refusal', () => {
    expect(scan).toMatch(/barcodeTypes: \['qr'\]/);
    expect(scan).toMatch(/Entole uses the camera to scan the square on someone’s Receive screen\./);
    expect(scan).toMatch(/Linking\.openSettings\(\)/);
    expect(scan).toMatch(/That isn't an Entole pay link\./);
    expect(scan).toMatch(/label="Try again"/);
    // A scan goes to the same door as a paste, and that door asks the
    // directory: a pay link names a username, which says nothing by itself.
    expect(scan.match(/resolveSendTarget\(/g)?.length).toBe(2);
    expect(scan).not.toMatch(/sendParamsFor\(/);
    expect(scan).toMatch(/pathname: '\/send'/);
  });

  it('bank payouts are gated honestly: no amount, no account number, no send', () => {
    expect(bank).toMatch(/aren’t available yet/);
    expect(bank).toMatch(/payment partner/);
    expect(bank).toMatch(/bank details/);
    expect(bank).not.toMatch(/<Keypad|TextInput|<Field|store\.send\(|useStore|relay\./);
  });

  it('Home and Pay lead to the same places: Send, Receive and the honest bank screen', () => {
    expect(home).toMatch(/router\.push\('\/send\/pick'\)/);
    expect(pay).toMatch(/href: '\/send\/pick'/);
    expect(pay).toMatch(/href: '\/receive'/);
    expect(pay).toMatch(/Send to a bank account/);
    expect(pay).toMatch(/href: '\/send\/bank'/);
    // Not shipped: bill payments are not connected, and "Send abroad" only repeated Send.
    expect(pay).not.toMatch(/href: '\/bill'|href: '\/abroad'/);
    expect(existsSync(join(ROOT, 'app/abroad/index.tsx'))).toBe(false);
  });
});

describe('Receive is a checkout link', () => {
  const receive = stripComments(read(join(ROOT, 'app/receive.tsx')));
  const sheet = stripComments(read(join(COMPONENTS, 'ui/RequestAmountSheet.tsx')));
  const onchain = stripComments(read(join(ROOT, 'lib/onchain.ts')));

  it('builds the link with buildPayLink, from the username and the app’s own origin', () => {
    expect(onchain).toMatch(/export const CHECKOUT_BASE = API_BASE/);
    expect(receive).toMatch(/buildPayLink\(CHECKOUT_BASE,/);
    expect(receive).toMatch(/\busername,/);
    expect(receive).toMatch(/currency: 'NGN'/);
    // The name on the pay page is the directory's to give, so the link carries none.
    expect(receive).not.toMatch(/\bpayee\b/);
  });

  it('has Copy link and Share link, and shares through the platform sheet', () => {
    expect(receive).toMatch(/'Copy link'/);
    expect(receive).toMatch(/label="Share link"/);
    expect(receive).toMatch(/Share\.share\(/);
    expect(receive).toMatch(/Clipboard\.setStringAsync\(text\)/);
  });

  it('requesting an amount opens a bottom sheet with the custom keypad, never the system keyboard', () => {
    expect(receive).toMatch(/<RequestAmountSheet/);
    expect(sheet).toMatch(/<Sheet /);
    expect(sheet).toMatch(/<Keypad/);
    expect(sheet).not.toMatch(/TextInput|<Field/);
    expect(sheet).not.toMatch(/<Modal/);
  });

  it('no leftover "Share on …" fixtures', () => {
    expect(receive).not.toMatch(/Share on |WhatsApp|Telegram/);
  });
});

describe('the bottom bar’s active tab is a capsule, and its ripple is clipped to it', () => {
  const icon = read(join(COMPONENTS, 'ui/TabBarIcon.tsx'));
  const bar = read(join(COMPONENTS, 'ui/FloatingTabBar.tsx'));

  it('rounds the highlight to at least half its height', () => {
    // Slots are 68 - 2 x 6 = 56 tall, so 28 is a full capsule.
    expect(icon).toMatch(/export const TAB_PILL_RADIUS = 28;/);
    expect(icon).toMatch(/borderRadius: TAB_PILL_RADIUS/);
    expect(68 - 2 * 6).toBeLessThanOrEqual(2 * 28);
  });

  it('clips the Android ripple to the same radius instead of a square', () => {
    expect(bar).toMatch(/borderRadius: TAB_PILL_RADIUS,\s*overflow: 'hidden'/);
    expect(bar).toMatch(/android_ripple=\{\{[^}]*borderless: false/);
  });

  it('the slot itself is the capsule, so its ground and its ripple are both clipped by their parent', () => {
    expect(bar).toMatch(/<View key=\{route\.key\} style=\{\{ flex: 1, borderRadius: TAB_PILL_RADIUS, overflow: 'hidden' \}\}>/);
    expect(bar).toMatch(/style=\{styles\.press\}/);
    expect(bar).not.toMatch(/<Pressable[\s\S]*?style=\{\[/);
  });
});

describe('Me is ordered Profile, Account, Preferences, Security, Support, Legal', () => {
  const me = read(join(ROOT, 'app/(tabs)/me.tsx'));

  it('lists Security below Preferences', () => {
    const order = ['Profile', 'Account', 'Preferences', 'Security', 'Support', 'Legal'].map((title) =>
      me.indexOf(`<SectionHeading title="${title}" />`),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('the Business tab is plain jobs, not seats and templates', () => {
  const business = stripComments(read(join(ROOT, 'app/(tabs)/business.tsx')));
  const businessScreens = walk(join(SCREENS, 'business')).map((file) => rel(file));

  it('order supplies, the supplier form and seats are gone, and nothing points at them', () => {
    for (const gone of ['order-supplies', 'pay-supplier', 'new-seat']) {
      expect(existsSync(join(ROOT, `app/business/${gone}.tsx`)), gone).toBe(false);
      for (const file of sourceFiles) {
        expect(stripComments(read(file)), `${relative(ROOT, file)} still mentions ${gone}`).not.toContain(gone);
      }
    }
  });

  it('leads with Invoices, Pay staff, Pay a supplier and Team', () => {
    for (const label of ['Invoices', 'Pay staff', 'Pay a supplier', 'Team']) {
      expect(business).toContain(`label: '${label}'`);
    }
    expect(business).toMatch(/href: '\/business\/payroll'/);
    expect(business).toMatch(/href: '\/business\/payroll\/add'/);
  });

  it('paying a supplier is the ordinary send, with the note filled in — not a second flow', () => {
    expect(business).toContain("href: '/send/pick?note=Supplier%20payment'");
    expect(business).not.toMatch(/store\.send\(|quoteSend|ConfirmSendSheet/);
  });

  it('says nothing about seats, presets, templates, roles or spending power', () => {
    const copy = userFacingCopy(read(join(SCREENS, '(tabs)/business.tsx'))).join(' | ');
    expect(copy).not.toMatch(/\b(seat|seats|preset|presets|template|templates|role|roles|spending power|permission|scope)\b/i);
    for (const path of businessScreens) {
      const words = userFacingCopy(read(join(ROOT, path))).join(' | ');
      expect(words, path).not.toMatch(/\b(seat|seats|preset|presets|role|roles|spending power|permission)\b/i);
    }
  });

  it('shows skeletons while it loads, and says what to do when there is nothing yet', () => {
    expect(business).toMatch(/<RowSkeleton/);
    expect(business).toMatch(/No invoices yet/);
    expect(business).toMatch(/No one on your team yet/);
    expect(business).toMatch(/useStaff\(\)/);
    expect(business).not.toMatch(/ActivityIndicator/);
  });

  it('every business screen is a real record or a real payment: no fixtures, no demo gateway, no address', () => {
    for (const path of ['app/(tabs)/business.tsx', ...businessScreens]) {
      const source = stripComments(read(join(ROOT, path)));
      expect(source, path).not.toMatch(/fixtures|demoGateway|address-book|procurement|saveSeat|revokeSeat|taxReserve/);
      expect(source, path).not.toMatch(/0x[0-9a-fA-F]{6,}|\.address\b|shortAddress/);
    }
  });

  it('the routes the redesign added exist', () => {
    for (const route of [
      'app/business/new-invoice.tsx',
      'app/business/invoice/[id].tsx',
      'app/business/payroll/index.tsx',
      'app/business/payroll/add.tsx',
      'app/business/payroll/import.tsx',
      'app/business/payroll/run.tsx',
    ]) {
      expect(existsSync(join(ROOT, route)), route).toBe(true);
    }
  });
});

describe('invoices carry a real checkout link', () => {
  const create = stripComments(read(join(ROOT, 'app/business/new-invoice.tsx')));
  const detail = stripComments(read(join(ROOT, 'app/business/invoice/[id].tsx')));

  it('the new-invoice screen builds an invoice pay link from the username, amount and reference', () => {
    expect(create).toMatch(/buildPayLink\(CHECKOUT_BASE/);
    expect(create).toMatch(/kind: 'invoice'/);
    expect(create).toMatch(/currency: 'NGN'/);
    for (const field of ['amountMinor', 'reference', 'note', 'dueAt']) {
      expect(create).toMatch(new RegExp(`\\b${field}\\b`));
    }
    expect(create).toMatch(/username: mine\.username/);
    expect(create).not.toMatch(/\bpaymentCode\b|buildCheckoutLink/);
    expect(detail).not.toMatch(/\bpaymentCode\b|buildCheckoutLink/);
    expect(create).toMatch(/store\.createInvoice\(/);
    // A link that could not be built is a message, never an invented one.
    expect(create).toMatch(/isn't ready yet/);
  });

  it('the amount goes in through the keypad sheet, and the due date through a sheet, not a modal or the system keyboard', () => {
    expect(create).toMatch(/<AmountSheet/);
    expect(create).toMatch(/<DueSheet/);
    expect(create).not.toMatch(/\bTextInput\b|<Modal/);
    expect(read(join(COMPONENTS, 'ui/AmountSheet.tsx'))).toMatch(/<Keypad/);
    const due = read(join(COMPONENTS, 'ui/DueSheet.tsx'));
    for (const choice of ['In {days} days', 'Pick a date']) expect(due).toContain(choice);
  });

  it('the invoice shows a big QR of the link, with Copy link and Share link', () => {
    expect(detail).toMatch(/<PaymentCode value=\{link\}/);
    expect(detail).toMatch(/Clipboard\.setStringAsync\(link\)/);
    expect(detail).toMatch(/Share\.share\(/);
    expect(detail).toContain("'Copy link'");
    expect(detail).toContain('label="Share link"');
    expect(detail).toMatch(/disabled=\{!link\}/);
  });

  it('marking paid is manual, confirmed in a sheet, and says nothing else moves', () => {
    expect(detail).toMatch(/store\.settleInvoice\(/);
    expect(detail).toMatch(/<ConfirmSheet/);
    expect(detail).toMatch(/no money moves/);
    expect(detail).toMatch(/marked paid automatically/);
  });

  it('status is Sent, Paid or Overdue, worked out from the due date', () => {
    const helpers = read(join(ROOT, '../../packages/core/invoices.ts'));
    expect(helpers).toMatch(/overdue/);
    expect(detail).toMatch(/invoiceDisplayStatus\(/);
  });
});

describe('payroll import never crashes an app that lacks the file picker', () => {
  const importer = stripComments(read(join(ROOT, 'app/business/payroll/import.tsx')));

  it('loads expo-document-picker inside a try, never as a top-level import', () => {
    expect(importer).toMatch(/try \{[^}]*require\('expo-document-picker'\)[^}]*\} catch/);
    for (const file of sourceFiles) {
      expect(stripComments(read(file)), relative(ROOT, file)).not.toMatch(/from 'expo-document-picker'/);
    }
  });

  it('says plainly that importing needs the updated app, and offers adding by hand', () => {
    expect(importer).toContain('Importing needs the updated app — you can add people by hand meanwhile.');
    expect(importer).toMatch(/Add someone by hand/);
  });

  it('copies the file to the cache and reads its bytes through the shared parser', () => {
    expect(importer).toMatch(/copyToCacheDirectory: true/);
    expect(importer).toMatch(/readFileBytes\(/);
    expect(importer).toMatch(/parsePayrollBytes\(/);
    expect(stripComments(read(join(ROOT, 'lib/read-file.ts')))).toMatch(/FileReader/);
  });

  it('reviews every row before saving, and shows each problem with its row', () => {
    expect(importer).toMatch(/problem\.message/);
    expect(importer).toMatch(/Use these/);
    expect(importer).toMatch(/source\.saveManyStaff\(/);
  });

  it('offers a sample file, and is honest that Google Sheets is not connected', () => {
    expect(importer).toMatch(/payrollTemplateCsv\(\)/);
    expect(importer).toMatch(/Share\.share\(/);
    expect(importer).toContain('Connect Google Sheets — coming soon');
    // Not faked: nothing in the app talks to Google.
    for (const file of sourceFiles) {
      expect(stripComments(read(file)), relative(ROOT, file)).not.toMatch(/googleapis|accounts\.google|sheets\.google/);
    }
  });
});

describe('a payroll run pays one person at a time and never shows a state early', () => {
  const run = stripComments(read(join(ROOT, 'app/business/payroll/run.tsx')));
  const runner = stripComments(read(join(ROOT, 'lib/payroll-run.ts')));

  it('sends each payment through store.send to a one-off recipient, with the note Payroll', () => {
    expect(run).toMatch(/store\.send\(\{ contactId, amountMinor: line\.amountMinor, note: 'Payroll', batch \}\)/);
    // Named, so the payment reads as theirs in activity and on its receipt.
    expect(run).toMatch(/oneOffId\(line\.code, line\.name\)/);
    expect(run).toMatch(/runPayroll\(/);
  });

  it('the runner awaits each payment in turn, and only then marks it settled', () => {
    expect(runner).toMatch(/for \(const line of lines\) \{[\s\S]*await send\(line\)[\s\S]*status: 'settled'/);
    expect(run).not.toMatch(/Promise\.all\(/);
    expect(runner).not.toMatch(/Promise\.all|forEach\(async/);
    expect(runner.indexOf("status: 'paying'")).toBeLessThan(runner.indexOf('await send(line)'));
  });

  it('works out the fees from real quotes, in parallel, with skeletons until they arrive', () => {
    expect(run).toMatch(/Promise\.allSettled\(missing\.map\(\(amount\) => quoteSend\(amount\)\)\)/);
    expect(run).toMatch(/<Skeleton/);
    expect(run).not.toMatch(/FEE_MINOR/);
  });

  it('checks total plus fees against the balance and leads to adding money', () => {
    expect(run).toMatch(/affordability\(totals\.totalMinor, store\.balance\)/);
    expect(run).toMatch(/Add money first/);
    expect(run).toMatch(/router\.push\('\/add-money'\)/);
    expect(run).toMatch(/lineProblem\(/);
  });

  it('is confirmed once, from a bottom-anchored button, and can retry what did not go through', () => {
    expect(run).toMatch(/Confirm and pay \$\{peopleWords\(lines\.length\)\}/);
    expect(run).toMatch(/<ActionBar>/);
    expect(run).toMatch(/Retry/);
    expect(run).toMatch(/stoppedForBalance/);
  });

  it('cannot be left mid-run, and its amounts come from the keypad sheet', () => {
    expect(run).toMatch(/hardwareBackPress/);
    expect(run).toMatch(/gestureEnabled: phase !== 'running'/);
    expect(run).toMatch(/<AmountSheet/);
    expect(run).not.toMatch(/\bTextInput\b/);
  });
});

describe('the rest of the screens are written on paper too', () => {
  it('every amount that stands alone is in the display face', () => {
    const amount = stripComments(read(join(COMPONENTS, 'ui/Amount.tsx')));
    expect(amount).not.toMatch(/font-(strong|heavy)/);
  });

  it.each(['app/add-money.tsx', 'app/receive.tsx', 'app/(tabs)/grow.tsx', 'components/ui/HoldingRow.tsx'])(
    '%s rules its rows and draws no bordered box',
    (path) => {
      expect(stripComments(read(join(ROOT, path)))).not.toMatch(/border border-line bg-card/);
    },
  );

  it('Grow keeps one raised surface and names the rest with section headings', () => {
    const hub = stripComments(read(join(ROOT, 'app/(tabs)/grow.tsx')));
    expect(hub).toMatch(/<SectionHeading title="Your money" \/>/);
    expect(hub).toMatch(/<SectionHeading title="Stocks" \/>/);
    expect(hub).toMatch(/<SectionHeading title="Earn" \/>/);
  });
});

describe('a phone holding an account from an earlier address still starts', () => {
  const session = stripComments(read(join(ROOT, 'lib/session.ts')));
  const entry = stripComments(read(join(ROOT, 'app/index.tsx')));
  const lock = stripComments(read(join(ROOT, 'app/lock.tsx')));

  it('a saved passkey is kept with the site it was made for', () => {
    const store = /async function storeCredential[\s\S]*?\n}\n/.exec(session)?.[0] ?? '';
    expect(store).toMatch(/setItemAsync\(CREDENTIAL_SITE_KEY, RP_ID\)/);
  });

  it('one made for another site is never asked for by name, and does not count as signed in', () => {
    const load = /async function loadCredential[\s\S]*?\n}\n/.exec(session)?.[0] ?? '';
    expect(load).toMatch(/credentialIsForThisSite\(\)/);
    const has = /export async function hasStoredCredential[\s\S]*?\n}\n/.exec(session)?.[0] ?? '';
    expect(has).toMatch(/credentialIsForThisSite\(\)/);
  });

  it('what is left of that account is cleared before the first screen is chosen', () => {
    expect(entry).toMatch(/clearAccountFromAnotherSite\(\)\s*\.then\(\(\) => Promise\.all\(\[hasOnboarded\(\), hasStoredCredential\(\)\]\)\)/);
    expect(session).toMatch(/deleteItemAsync\(CREDENTIAL_SITE_KEY\)/);
  });

  it('the lock screen has a way out after a failed unlock, and it asks first', () => {
    expect(lock).toMatch(/label="Start again on this phone"[^>]*onPress=\{\(\) => setStartingAgain\(true\)\}/);
    expect(lock).toMatch(/label="Start again" variant="danger-outline" onPress=\{\(\) => void startAgain\(\)\}/);
    expect(lock).toMatch(/The account and its money are not touched/);
    expect(lock).not.toMatch(/label="Start again on this phone"[^>]*onPress=\{[^}]*forgetEverything/);
  });
});

describe('the bottom of a screen, and the keyboard', () => {
  const screen = stripComments(read(join(ROOT, 'components/ui/Screen.tsx')));

  it('always leaves room under the last element, even on a phone that reports no inset', () => {
    expect(screen).toMatch(/Math\.max\(insets\.bottom, BOTTOM_FLOOR\)/);
    expect(Number(/BOTTOM_FLOOR = (\d+)/.exec(screen)?.[1])).toBeGreaterThanOrEqual(12);
  });

  it('a screen someone types on ends above the keyboard, so its button rides up with it', () => {
    expect(screen).toMatch(/keyboard \? \(\s*<KeyboardAvoidingView behavior="padding"/);
    for (const path of ['app/onboarding/name.tsx', 'app/bill/[category].tsx', 'app/assistant.tsx']) {
      expect(stripComments(read(join(ROOT, path))), path).toMatch(/<Screen keyboard>/);
    }
  });

  it('the name step can scroll, and Next moves on to the username', () => {
    const name = stripComments(read(join(ROOT, 'app/onboarding/name.tsx')));
    expect(name).toMatch(/<ScrollView[\s\S]*?keyboardShouldPersistTaps="handled"/);
    expect(name).toMatch(/onSubmitEditing=\{\(\) => usernameField\.current\?\.focus\(\)\}/);
  });
});

describe('every movement of the person\'s own money is confirmed with a fingerprint', () => {
  const onchain = stripComments(read(join(ROOT, 'lib/onchain.ts')));
  const session = stripComments(read(join(ROOT, 'lib/session.ts')));
  const sheet = stripComments(read(join(ROOT, 'components/ui/SavingsSheet.tsx')));

  it('the gateway is given the phone\'s own prompt, titled with what is about to happen', () => {
    expect(onchain).toMatch(/confirmWithScreenLock\(describeMovement\(movement\)\)/);
    expect(onchain).toMatch(/if \(!confirmed\.ok\) throw new MovementNotConfirmedError\(confirmed\.reason\);/);
    expect(onchain).toMatch(/createOnChainGateway\(\{\s*publicClient,\s*ownerWalletClient,\s*confirmMovement,/);
    expect(session).toMatch(/LocalAuthentication\.authenticateAsync\(/);
    expect(session).toMatch(/Not confirmed\. Nothing was moved\./);
  });

  it('a screen does not ask a second time: the gateway is the one place', () => {
    expect(sheet).not.toMatch(/confirmWithScreenLock/);
    for (const file of sourceFiles.filter((path) => /\/(app|components)\//.test(path))) {
      expect(stripComments(read(file)), rel(file)).not.toMatch(/confirmWithScreenLock\(/);
    }
  });

  it('a payroll run is confirmed once, for the people and the total', () => {
    const run = stripComments(read(join(ROOT, 'app/business/payroll/run.tsx')));
    expect(run).toMatch(/totalMinor: targets\.reduce\(/);
    expect(run).toMatch(/note: 'Payroll', batch \}/);
  });
});

describe('a loading list looks like the list', () => {
  const skeleton = stripComments(read(join(ROOT, 'components/ui/Skeleton.tsx')));

  it('row skeletons are ruled rows, not bordered boxes', () => {
    const row = /export function RowSkeleton[\s\S]*?\n}\n/.exec(skeleton)?.[0] ?? '';
    expect(row).toMatch(/border-b border-hairline/);
    expect(row).not.toMatch(/border border-line bg-card/);
  });

  it('stocks load as stock rows: a logo, a name over a symbol, a price over a change', () => {
    expect(skeleton).toMatch(/export function StockRowSkeleton/);
    expect(stripComments(read(join(ROOT, 'components/ui/StockCatalogue.tsx')))).toMatch(/<StockRowSkeleton key=\{index\} index=\{index\} \/>/);
    expect(stripComments(read(join(ROOT, 'app/grow/stocks.tsx')))).not.toMatch(/<RowSkeleton/);
  });
});

describe('the bar is a capsule round the capsules in it', () => {
  it('its radius is the tab radius plus the padding between them, half its own height', () => {
    const bar = read(join(COMPONENTS, 'ui/FloatingTabBar.tsx'));
    expect(bar).toMatch(/const BAR_RADIUS = TAB_PILL_RADIUS \+ BAR_PADDING;/);
    expect(bar).toMatch(/padding: BAR_PADDING,\s*borderRadius: BAR_RADIUS/);
    const padding = Number(/const BAR_PADDING = (\d+)/.exec(bar)?.[1]);
    const height = Number(/TAB_BAR_HEIGHT = (\d+)/.exec(bar)?.[1]);
    expect(28 + padding).toBe(height / 2);
  });
});

describe('a username is one person\'s, and it is how they are paid', () => {
  const name = stripComments(read(join(ROOT, 'app/onboarding/name.tsx')));
  const edit = stripComments(read(join(ROOT, 'app/edit-profile.tsx')));
  const tabs = stripComments(read(join(ROOT, 'app/(tabs)/_layout.tsx')));
  const pick = stripComments(read(join(ROOT, 'app/send/pick.tsx')));
  const recipient = stripComments(read(join(ROOT, 'lib/recipient.ts')));
  const receive = stripComments(read(join(ROOT, 'app/receive.tsx')));

  it.each([
    ['sign-up', name],
    ['edit profile', edit],
  ])('%s asks the directory as the name is typed and will not go on with one that is taken', (_where, source) => {
    expect(source).toMatch(/useUsernameCheck\(API_BASE, username, account\?\.owner\.address\)/);
    expect(source).toMatch(/check === 'taken' \|\| refused === username/);
    expect(source).toMatch(/\{USERNAME_TAKEN\}/);
  });

  it.each([
    ['sign-up', name],
    ['edit profile', edit],
  ])('%s claims the username with the account, and a refusal saves nothing', (_where, source) => {
    const claim = source.indexOf('backend.directory.claim(');
    expect(claim).toBeGreaterThan(-1);
    expect(source.slice(claim, claim + 260)).toMatch(/username,/);
    expect(source).toMatch(/error\.code === 'username_taken'\) \{\s*setRefused\(username\);/);
    // The claim comes before the profile is stored on the phone.
    expect(claim).toBeLessThan(source.indexOf('await storeProfile(profile)'));
  });

  it('an account made before this claims its username when the app opens, and is sent to choose again if it lost', () => {
    expect(tabs).toMatch(/useUsernameClaim\(\);/);
    expect(tabs).toMatch(/if \(await usernameClaimRecorded\(address, username\)\) return;/);
    expect(tabs).toMatch(/pathname: '\/edit-profile', params: \{ taken: '1' \}/);
  });

  it('the send field takes a username or a number, and names the person from the directory', () => {
    expect(pick).toMatch(/placeholder="@username or 0803 123 4567"/);
    expect(pick).toMatch(/readRecipient\(text\)/);
    expect(recipient).toMatch(/findRecipient\(backend\.directory, sought\)/);
    // The id carries the name the directory has, so every screen after this names the person.
    expect(recipient).toMatch(/oneOffId\(found\.code, found\.payee\)/);
    expect(read(join(ROOT, '../../packages/core/recipient.ts'))).toMatch(/payee: identity\.name/);
  });

  it('receive shows the username, and there is no long code under it', () => {
    expect(receive).toMatch(/title="Your username"/);
    expect(receive).toMatch(/@\{username\}/);
    expect(receive).not.toMatch(/title="Your code"/);
  });
});

describe('an unanswered username claim is tried again', () => {
  it('each time the app comes to the front, until the directory has said yes or no', () => {
    const tabs = stripComments(read(join(ROOT, 'app/(tabs)/_layout.tsx')));
    const claim = /function useUsernameClaim\(\)[\s\S]*?\n}\n/.exec(tabs)?.[0] ?? '';
    expect(claim).toMatch(/AppState\.addEventListener\('change', \(state\) => \{\s*if \(state === 'active'\) void attempt\(\);/);
    expect(claim).toMatch(/if \(await usernameClaimRecorded\(address, username\)\) return;/);
    // A refusal is an answer: it does not reopen the sheet on every return.
    expect(claim).toMatch(/refused = true;/);
    expect(claim).toMatch(/if \(trying \|\| refused/);
  });
});

describe('a payment the network refuses says so', () => {
  const action = stripComments(read(join(ROOT, 'app/assistant-action.tsx')));

  it('the reason is shown, not swallowed, and the countdown does not start again', () => {
    expect(action).toMatch(/catch \(error\) \{\s*setSending\(false\);\s*setProblem\(plainMessage\(error,/);
    expect(action).toMatch(/accessibilityRole="alert"/);
    expect(action).toMatch(/running=\{!stopped && !sending && !problem\}/);
    expect(action).toMatch(/'Not sent\. Nothing was taken\.'/);
  });
});

describe('a phone with a screen lock and no fingerprint can use the app', () => {
  const session = stripComments(read(join(ROOT, 'lib/session.ts')));
  const check = /async function checkDeviceCanAuthenticate[\s\S]*?\n}\n/.exec(session)?.[0] ?? '';

  it('any screen lock is enough: only a phone with none is turned away', () => {
    expect(check).toMatch(/getEnrolledLevelAsync\(\)/);
    expect(check).toMatch(/SecurityLevel\.NONE/);
    // Biometric hardware and enrolment are not conditions any more.
    expect(check).not.toMatch(/hasHardwareAsync|isEnrolledAsync/);
    expect(check).toMatch(/a PIN, a pattern, a fingerprint or a face/);
  });

  it('confirming a movement lets a PIN, pattern or password answer', () => {
    expect(session).toMatch(/disableDeviceFallback: false/);
  });
});

describe('someone who has not signed up cannot reach the assistant', () => {
  it.each(['app/legal/terms.tsx', 'app/legal/privacy.tsx'])('%s leaves the control out for them, and keeps it for anyone signed in', (path) => {
    expect(stripComments(read(join(ROOT, path)))).toMatch(/trailing=\{account \? undefined : null\}/);
  });

  it('the assistant screen sends them to the start', () => {
    expect(stripComments(read(join(ROOT, 'app/assistant.tsx')))).toMatch(/if \(!account\) return <Redirect href="\/" \/>;/);
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

  it('a pay link opened from outside the app has a screen to land on', () => {
    const route = stripComments(read(join(ROOT, 'app/pay/[code].tsx')));
    expect(route).toMatch(/payLinkFromRoute\(params\)/);
    expect(route).toMatch(/resolveSendTarget\(link, undefined, backend\)/);
    expect(route).toMatch(/pathname: '\/send'/);
    // Opened cold, the person unlocks first and is brought back to the link.
    expect(route).toMatch(/pathname: '\/lock', params: link \? \{ next: link \} : \{\}/);
    expect(stripComments(read(join(ROOT, 'app/lock.tsx')))).toMatch(/isPayPath\(next\)/);
    expect(route).toMatch(/<Header /);
    expect(route).toMatch(/Nothing was sent\./);
  });

  it('the phone number field takes the number the way people write it, zero and all', () => {
    const phone = stripComments(read(join(ROOT, 'app/onboarding/phone.tsx')));
    expect(phone).toMatch(/normalizeNigerianNumber\(digits\)/);
    expect(phone).toMatch(/digits\.startsWith\('0'\) \? 11 : 10/);
    expect(phone).toMatch(/phone: \{ country: 'ng', number \}/);
    expect(phone).not.toMatch(/MAX_DIGITS/);
    expect(phone).toMatch(/<Keypad/);
  });
});

describe('money that arrives is listed and said', () => {
  const announcer = stripComments(read(join(COMPONENTS, 'ui/ArrivalAnnouncer.tsx')));
  const onchain = stripComments(read(join(ROOT, 'lib/onchain.ts')));
  const layout = stripComments(read(join(ROOT, 'app/_layout.tsx')));

  it('the gateway reports sends and collects arrivals', () => {
    expect(onchain).toMatch(/createPaymentsFeedClient\(\{/);
    expect(onchain).toMatch(/baseUrl: API_BASE,/);
    expect(onchain).toMatch(/\n\s+payments,\n\s+resolveContactId: source\.resolveContactId,/);
  });

  it('an arrival is said once, in the one banner, with who and how much', () => {
    expect(announcer).toMatch(/sent you \$\{formatNaira\(kobo\(latest\.amountMinor\)\)\}/);
    expect(announcer).toMatch(/show\(/);
    expect(announcer).toMatch(/clearArrivals\(\);/);
    expect(announcer).toMatch(/return null;/);
    expect(announcer).not.toMatch(/\.address\b|0x/);
    expect(layout).toMatch(/<ArrivalAnnouncer \/>\s*<ToastHost \/>/);
  });
});

describe('saving someone asks for a nickname and nothing else', () => {
  const add = stripComments(read(join(ROOT, 'app/beneficiaries/new.tsx')));

  it('shows the name the directory gave instead of asking for it', () => {
    expect(add).toMatch(/const knownName = \(paid\?\.name \|\| person\?\.payee \|\| ''\)\.trim\(\);/);
    expect(add).toMatch(/\{knownName\}/);
    expect(add).toMatch(/label="Nickname"\s+optional/);
    // A name is only asked for when nothing named them.
    expect(add).toMatch(/\{known && !knownName \? \(\s*<Field\s+label="Name"/);
    // Where they live and their bank are not part of saving someone any more.
    expect(add).not.toMatch(/BeneficiaryForm|CountrySheet|Bank details/);
  });
});
