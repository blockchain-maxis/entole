# Entole — Design

The direction set on 11 October 2026, after an audit of every screen in both
apps. It replaces the earlier version of this file. Tokens live in
`packages/tokens`; this document says what each one is for.

## The idea

"Entole" means an instruction, a mandate. The product is a written instruction
with a limit that cannot be exceeded. So the app looks like paper that has been
written on, in two inks.

**Black ink is you. Blue ink is the assistant.**

Everything a person does themselves is ink: headings, primary buttons, their
own payments, what is selected, what has focus. Blue appears only where the
assistant has acted or may act. A person learns it without being told: if it is
blue, the assistant did it or can.

## Feel

A bank that respects you. Warm, light, quiet, unhurried. Generous whitespace.
Nothing decorative. Money apps earn trust by looking like they have nothing to
hide.

The failure mode to avoid is unchanged: this must never look like a crypto app.
No dark cards, no gradient accents, no wallet iconography, no neon.

## Colour roles

Reference tokens by name only. Values are in `packages/tokens/design-tokens.js`,
with a warm dark palette beside the light one.

| Token | Role |
|---|---|
| `ink` | You. Text, balances, primary buttons, selection, the focus ring |
| `slate` | Secondary text and every label |
| `mist` | Placeholders and disabled only. Never a label: it cannot be read |
| `paper` | The page |
| `card` | The one raised surface on a screen, and sheets |
| `line`, `hairline` | Rules between rows; the edge of a field |
| `press` | A pressed or hovered row; something that cannot be pressed yet |
| `indigo`, `indigo-wash` and the rest of the family | The assistant, and nothing else: its tint, its badge, its countdown, an allowance's surface, its rows in activity, "ask the assistant" |
| `settled` | Delivered, positive |
| `caution` | An allowance nearly spent |
| `halt` | Stop, blocked, destructive |

- Blue is not a link colour, a selection colour or an emphasis colour. A link
  is ink with an underline or a chevron.
- The allowance meter keeps its three tones, `settled` to `caution` to `halt`
  as it drains. What surrounds it is the assistant's blue.
- `paper` is off-white on purpose. Pure white is harsh in bright sun, and the
  warmth is what makes it read as money and not as a dashboard.

## Type

Two families.

- **Display**, Source Serif 4: headlines, the hero figure, the allowance
  sentence. It is what makes a screen read as written. A display face must
  carry the naira sign and tabular lining figures, checked in the font file
  itself; Fraunces was tried first and has no tabular figures, so amounts set
  in it would shift as digits change. `font-display` is its 600 weight,
  `font-display-plain` its 400.
- **Interface**, Plus Jakarta Sans: everything else, in four weights. `font-plain`
  400, `font-body` 500, `font-strong` 600, `font-heavy` 700, on both platforms.

Seven sizes, each with one job:

| Role | Size / line | Use |
|---|---|---|
| `figure` | 56 / 60 | The one number a screen is about: a balance, a receipt's amount |
| `heading` | 28 / 34 | What a screen says first |
| `subhead` | 20 / 26 | A section |
| `prose` | 17 / 25 | Reading text; a row's main line |
| `ui` | 15 / 21 | Controls, a row's second line |
| `note` | 13 / 18 | Labels and captions, in `slate` |
| `micro` | 11 / 14 | Badges only |

- Balances and amounts: tabular figures, always. No jitter as digits change.
- Naira: `₦`, thousands separators, two decimals only when non-zero.
- Sentence case everywhere. No exclamation marks.

Every screen is on these. The earlier scale of 25 sizes was removed from the
preset on 11 October 2026, with the five extra radii. Three sizes exist beside
the seven for one place each: `poster` for the first page's headline on a wide
screen, `sentence` for the allowance sentence on the phone, `key` for the
keypad.

## Surfaces

**Rules, not boxes.** A list is rows on paper with a hairline between them. A
border around every row made every row equally important, and so none.

**One raised surface per screen**, in `card` with the `raised` shadow, for the
thing the screen is about. Everything else sits on paper.

**Four radii**: `control` for buttons and fields, `card` for the raised surface,
`sheet` for sheets, `pill` for chips and badges.

## Motion

- Sheets rise on a curve that does not overshoot, about 260ms, and can be
  dragged away.
- Settlement: the state change is the animation. Do not decorate it.
- Undo countdown: linear, continuous, never stepped.
- A press gives way: a small move or scale, and a change of ground.
- Focus is a visible ring in `ink`, on everything that can take it.
- Haptics: success on settlement, warning on pausing. Resuming is a light touch.
- **The mark is the only thing that turns.** Its ring draws round from the top
  and stops where it meets the bar, rests, lets go and starts again: a limit
  it cannot pass, in one motion. It is for the app starting (the intro that
  follows the splash screen), a page that is not known yet, and a button that
  is busy. It never stands in for content that has a shape.
- Anything that moves respects a reduced-motion setting.

## Patterns

**Bottom sheets, not modals.** Dismissible by gesture. Everything operable
one-handed.

**Bottom-anchored primary actions.** Nothing important in the top corners except
the pause control.

**Custom numeric keypad** for every amount entry.

**Skeletons, not spinners.** A list, a balance, a row: each loads as a skeleton
in its own shape. The one exception is the Entole mark itself (see Motion).

**People first.** Paying starts from the people already saved; a payment code
is how someone new gets in. A person is a name and initials that can be read,
and a photo when there is one. The address should be impossible to reach
without deliberately hunting for it, and there is no reason to build that hunt.

**An allowance is a sentence.** "Send ₦50,000 to Mum every month, never more
than ₦100,000 a month." Each value is a blank that can be tapped; the whole
thing reads back in one breath, on both platforms. It is never a form.

**The allowance meter is the persistent motif.** Same component everywhere.

**Every state is designed**: loading, empty, failed, busy, done. A failed read
never shows a figure. An empty list says what would fill it and offers to.

**Nothing that cannot be undone happens on one tap.** It asks first, in place.

**A field has a label, a section has a heading.** The display face names
sections and screens. What sits above an input, a picker or a set of choices is
a label: `font-strong text-note text-slate`. A form whose every field shouts
in the display face has no hierarchy left.

**One raised surface a screen.** Savings on Grow, the scan code on Receive, the
invoice on a pay page. Everything else on that screen is ruled rows on paper.

## Words

One word for each thing, everywhere a person reads.

| Say | Never |
|---|---|
| allowance | rule, permission, cap |
| limit (of an allowance) | cap |
| beneficiary | contact, recipient, saved person |
| Send | Pay or Transfer, for the same act |
| delivered | final, settled, paid, for the same state |
| the assistant | Entole, when it is the assistant acting |

## Screens

| Route (phone / browser) | What it is |
|---|---|
| `(tabs)/index` / `/` | The balance as the figure, three actions, allowances as sentences, activity as ruled rows |
| `rules/new` / `/rules/new` | The allowance sentence |
| `rules/[id]` / `/rules/[id]` | Meter, what is left, its payments, revoke |
| `send`, `send/pick` / `/transfer/send` | Beneficiaries first, keypad, review sheet |
| `send/receipt` / the receipt step | One receipt for every kind of payment, the amount as the figure |
| `receive` / `/receive` | Link and scan code, no app needed |
| `add-money` / `/add-money` | The balance as a line on paper, then the ways to add |
| `(tabs)/grow` / `/grow` | Savings raised; your money, stocks and earning as ruled sections |
| `(tabs)/business` / `/business` | Services as ruled rows, then invoices |
| `pause` | Stopping the assistant |
| `onboarding` / the account gate | The first screen: what Entole is, one button |
| the public pay page, `/pay/[code]` | For someone who is not a user: who, how much, the way that works first |
| the assistant's undo window | Blue ink, a continuous countdown, one way to stop it |

Grow (savings, stocks) and Business follow the same patterns. The stock list
and stock page keep their layout: rows in the shape of every other list, a
change in `settled` when up and `halt` when down, one line chart in the same two
colours. The Buy button sits at the bottom, in `press` with a "Coming soon"
chip, and cannot be pressed.

**Wide windows.** From 1024px the five places run along the top of the browser
window, with the mark beside them; the floating tab bar is for narrower windows
only (`BottomNav`, and the room `AuthGate` leaves above each page). Home sets
the account (balance, actions, allowances) beside its activity. Every other
signed-in page stays one readable column, centred: a form does not get better
by being wider. The pause control stays in each page's own header at every
width.

No image exports exist in `design/`. Screens are built to this document.

## Test conditions

Build and test on a mid-range Android on a throttled connection. Not an iPhone on
wifi. Keep the bundle small, make reads work offline, queue sends. A judge who
watches this stay responsive on 3G learns more than any slide will tell them.
