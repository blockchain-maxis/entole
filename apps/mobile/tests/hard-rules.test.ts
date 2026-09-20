import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
    expect(home).toMatch(/assistant\.enabled \?[\s\S]*?router\.push\('\/rules\/new'\)[\s\S]*?router\.push\('\/assistant'\)/);
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

  // Receive became a checkout link (QR of the link, the plain code underneath);
  // the older assertions that it shows only the bare code were replaced with these.
  it('Receive shows the real checkout link as a QR, and the real code as text', () => {
    expect(receive).toMatch(/useBackend\(\)/);
    expect(receive).toMatch(/paymentCode/);
    expect(receive).toMatch(/<PaymentCode value=\{link\}/);
    expect(receive).toMatch(/<PaymentCodeText code=\{paymentCode\}/);
    expect(receive).toMatch(/Your code/);
    expect(receive).not.toMatch(/store\.request|useStore/);
  });

  it('Receive copes with no code yet by showing a skeleton and a disabled Copy link', () => {
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
    expect(senders.map((file) => relative(ROOT, file))).toEqual([
      'app/business/payroll/run.tsx',
      'components/ui/ConfirmSendSheet.tsx',
    ]);
  });

  it('adding a beneficiary decodes a payment code and never renders an address', () => {
    for (const path of beneficiaryScreens) {
      const source = stripComments(read(join(ROOT, path)));
      // The address may travel in the record; it may not reach a screen.
      expect(source, path).not.toMatch(/\{[^{}]*\baddress\b[^{}]*\}\s*<\/Text>|<Text[^>]*>\s*\{[^{}]*\baddress\b/);
      expect(source, path).not.toMatch(/shortAddress|truncateAddress|formatAddress|slice\(0,\s*6\)/);
    }
    const add = stripComments(read(join(ROOT, 'app/beneficiaries/new.tsx')));
    expect(add).toMatch(/decodePaymentCode\(/);
    expect(add).toMatch(/source\.saveBeneficiary\(/);
    expect(add).toMatch(/store\.refresh\(\)/);
    expect(add).toMatch(/That code doesn't look right — check it and try again/);
    expect(add).toMatch(/your own payment code/);
    expect(add).toMatch(/already have/);
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

  it('the recipient step is one code-or-link field, read through parseCheckout, with Paste and Scan', () => {
    expect(pick).toMatch(/Who are you sending to\?/);
    expect(pick).toMatch(/parseCheckout\(/);
    expect(pick).toMatch(/That code doesn't look right — check it and try again\./);
    expect(pick).toMatch(/Clipboard\.getStringAsync\(\)/);
    expect(pick).toMatch(/>Paste</);
    expect(pick).toMatch(/pathname: '\/send\/scan'/);
    expect(pick).toMatch(/Scan their QR code/);
    // A link's letters are case-sensitive; forcing capitals would break the link.
    expect(pick).not.toMatch(/autoCapitalize="characters"/);
  });
});

describe('Grow shows only what is real', () => {
  // Savings is money held 1:1 in the person's account and it pays no interest,
  // so nothing in Grow may show earnings, a payout date, a rate of return, a
  // ticker or a holding that did not come from the store.
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

  it.each(growSource)('%s never reads accrued earnings or a payout date', (_path, source) => {
    expect(source).not.toMatch(/accruedMinor|nextPayoutAt|payoutLabel|daysUntil|earned so far/);
  });

  it.each(growSource)('%s shows no yield, rate of return or percentage earned', (_path, source) => {
    const copy = userFacingCopy(source).join('\n');
    expect(copy).not.toMatch(/\b(yield|apy|apr|p\.a\.|per year|a year|annual|rate of return|returns on)\b/i);
    expect(copy).not.toMatch(/\d\s*%\s*(interest|yield|return|apy|apr)/i);
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

  it('stocks are gated with the honest sentence until a broker is connected', () => {
    for (const source of [hub, stocks, trade]) {
      expect(source).toMatch(/Buying stocks opens when our brokerage partner is connected/);
      expect(source).toMatch(/stocksAvailable/);
    }
  });

  it('stocks show skeletons while loading and surface the error message inline', () => {
    expect(stocks).toMatch(/RowSkeleton/);
    expect(stocks).toMatch(/plainMessage\(error/);
    expect(trade).toMatch(/<Skeleton/);
    expect(trade).toMatch(/plainMessage\(error/);
  });
});

describe('sending is one simple step: a code or a link, scanned or pasted', () => {
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
    expect(recipient).toMatch(/parseCheckout\(/);
    expect(recipient).toMatch(/oneOffId\(/);
    expect(recipient).toMatch(/parsed\.currency === 'NGN'/);
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
    expect(scan).toMatch(/Entole uses the camera to scan a payment code\./);
    expect(scan).toMatch(/Linking\.openSettings\(\)/);
    expect(scan).toMatch(/That doesn't look like an Entole code\./);
    expect(scan).toMatch(/label="Try again"/);
    // A scan goes to the same door as a paste.
    expect(scan).toMatch(/sendParamsFor\(/);
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

  it('builds the link with buildCheckoutLink from the app’s own origin', () => {
    expect(onchain).toMatch(/export const CHECKOUT_BASE = API_BASE/);
    expect(receive).toMatch(/buildCheckoutLink\(CHECKOUT_BASE,/);
    expect(receive).toMatch(/kind: 'pay'/);
    expect(receive).toMatch(/currency: 'NGN'/);
    expect(receive).toMatch(/payee/);
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
  const businessScreens = walk(join(SCREENS, 'business')).map((file) => relative(ROOT, file));

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

  it('the new-invoice screen builds an invoice checkout link from the payment code, amount and reference', () => {
    expect(create).toMatch(/buildCheckoutLink\(CHECKOUT_BASE/);
    expect(create).toMatch(/kind: 'invoice'/);
    expect(create).toMatch(/currency: 'NGN'/);
    for (const field of ['amountMinor', 'payee', 'reference', 'note', 'dueAt']) {
      expect(create).toMatch(new RegExp(`\\b${field}\\b`));
    }
    expect(create).toMatch(/code: paymentCode/);
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
    expect(run).toMatch(/store\.send\(\{ contactId, amountMinor: line\.amountMinor, note: 'Payroll' \}\)/);
    expect(run).toMatch(/oneOffId\(line\.code\)/);
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
