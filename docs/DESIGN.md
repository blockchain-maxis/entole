# Entole — Design

Reference exports live in `design/`, one PNG per screen, named to match the
route. Implement to match them. If a screen has no export, follow the patterns
below and flag it.

## Feel

A bank that respects you. Warm, light, quiet, unhurried. Generous whitespace.
Nothing decorative. Money apps earn trust by looking like they have nothing to
hide.

The failure mode to avoid: this must never look like a crypto app. No dark cards,
no gradient accents, no wallet iconography, no neon.

## Colour tokens

Put these in `tailwind.config.js` under `theme.extend.colors`. Reference by name
only.

| Token | Hex | Use |
|---|---|---|
| `ink` | `#12100E` | Primary text, balances |
| `slate` | `#5C564E` | Secondary text, labels |
| `mist` | `#A39C92` | Tertiary, disabled, placeholders |
| `paper` | `#FBF9F5` | App background |
| `card` | `#FFFFFF` | Surfaces, sheets |
| `line` | `#E8E2D8` | Borders, dividers |
| `indigo` | `#2B4EE6` | Primary action, links, focus |
| `indigo-wash` | `#EDF0FE` | Selected state, assistant-action tint |
| `settled` | `#0F7A52` | Confirmed payments, positive |
| `caution` | `#B8860B` | Allowance nearly spent |
| `halt` | `#C4362F` | Kill switch, blocked, destructive |

One accent only. `indigo-wash` is the workhorse: it is how assistant activity
reads as different from the user's own without shouting.

Allowance meters travel `settled` → `caution` → `halt` as they drain.

`paper` is off-white deliberately. Pure white is harsh in bright sun, and the
warmth is what makes it read as money rather than as a dashboard.

## Type

- Balances and amounts: tabular figures, always. No jitter as digits change.
- Type scale: 40 / 28 / 20 / 17 / 15 / 13.
- Body 17. Labels 13, `slate`.
- Naira: `₦` symbol, thousands separators, two decimals only when non-zero.

## Motion

- Sheets: spring, damping 20, stiffness 220.
- Settlement: the state transition is the animation. Do not decorate it.
- Undo countdown: linear, continuous, never stepped.
- Haptics: success notification on settlement, warning on pause-everything.

## Patterns

**Bottom sheets, not modals.** Dismissible by gesture. Everything operable
one-handed.

**Bottom-anchored primary actions.** Nothing important in the top corners except
the pause control.

**Custom numeric keypad** for every amount entry.

**Skeletons, not spinners.**

**Contacts-first recipients.** A person with a photo and a name. The address
should be impossible to reach without deliberately hunting for it, and there is
no reason to build that hunt.

**Sentence-shaped rules.** The rule builder is a fill-in-the-blank sentence with
tappable pills, not a form and not a wizard. The user reads the whole rule back
in one breath.

**Allowance meter is the persistent motif.** Same component everywhere. Users
learn to read it at a glance.

## Screens

| Route | Export | Notes |
|---|---|---|
| `app/(tabs)/index` | `home.png` | Balance, allowances, activity |
| `app/rules/new` | `rule-builder.png` | Sentence with tappable pills |
| `app/rules/[id]` | `allowance-detail.png` | Meter, history, revoke |
| `app/send` | `send.png` | Contact, keypad, live conversion |
| `app/send/receipt` | `receipt.png` | Timestamped, settled, shareable |
| `app/receive` | `receive.png` | Link + QR, no app needed |
| `app/pause` | `pause.png` | Kill switch confirmation |
| `app/onboarding` | `onboarding-*.png` | Three screens, under 30 seconds |
| sheet | `assistant-action.png` | Undo countdown over home |

No PNG exports exist in `design/` for any route as of this writing — every
screen above, including the ones with an export listed, was built to this
table's descriptions and the patterns below, not against an image. Treat
that as the current reality, not a rule.

The business layer added 17 September 2026 (`docs/SCOPE.md`) has no exports
either: `app/(tabs)/business`, `app/business/new-invoice`,
`app/business/invoice/[id]` and `app/business/payroll/*` (roster, add, import,
run). Same rule as any other unexported screen — they follow the patterns
below rather than introducing new ones. Seats were removed from the UI: a team
member is a plain person you pay, with an optional regular amount.

The Grow layer added 23 September 2026 (`docs/SCOPE.md`) has no exports either:
`app/(tabs)/grow`, `app/grow/savings`, `app/grow/stocks` and
`app/grow/stock/[symbol]` on the phone, with the matching `grow/*` routes on
web. Savings reuses the custom keypad and the review-sheet pattern; the meter
motif and the "not available yet" empty state follow the patterns below. Same
rule as any other unexported screen.

## Test conditions

Build and test on a mid-range Android on a throttled connection. Not an iPhone on
wifi. Keep the bundle small, make reads work offline, queue sends. A judge who
watches this stay responsive on 3G learns more than any slide will tell them.
