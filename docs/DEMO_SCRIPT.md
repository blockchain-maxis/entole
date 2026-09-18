# Entole — demo script

For the submission video. Follows `docs/PRODUCT.md`'s "what success looks
like in the demo" exactly — three moments, no vocabulary. Runs on the phone
app; the web app never needs to appear in this video (`docs/SCOPE.md`: "not
allowed to cost [the phone demo] a day," and that includes screen time).

Target length: 90 seconds. Say less than the screen shows.

## Setup, before recording

- Real mid-range Android, not a simulator (`docs/DESIGN.md`'s own test
  condition). Throttle to 3G if the device/network allows it.
- Fresh onboarding run once beforehand so the demo run starts from a
  populated account, not an empty one.
- Sound on: the settlement haptic and the pause haptic are part of the
  moment, even though a viewer only hears the phone's own case buzz, not
  the haptic itself — cue the narration to the visual state change instead.

## Moment 1 — a payment settles in under a second (0:00–0:25)

1. Home tab, balance visible. Say the balance out loud once, naturally —
   "she's got about a hundred and twenty-eight thousand naira in here."
2. Tap **Send**, pick a contact, key in an amount on the custom keypad —
   let the keypad show on screen for a beat, it's part of the "no bank
   app ever felt like this" argument.
3. Tap **Send ₦…**. Do not talk over the transition. The settlement state
   change *is* the moment — say nothing until the receipt screen is up.
4. On the receipt: point at the timestamp. "Sent and settled — same
   second." That line, then cut.

## Moment 2 — an assistant action, cancelled mid-countdown (0:25–0:55)

1. Return to home. The assistant-action sheet appears over it (or trigger
   it from wherever it's reachable in the current build).
2. Let the countdown ring run for two or three seconds on screen before
   speaking — the ring itself is the argument, not a sentence about it.
3. "The assistant proposed this — see the tint, that's how you always know
   it wasn't you." Point at the indigo-wash tint, not at copy.
4. Tap cancel mid-countdown. Confirm out loud: "Cancelled. Nothing left."
   Cut to the activity feed showing nothing settled.

## Moment 3 — an allowance refuses to go past its limit (0:55–1:20)

1. Open an allowance near its cap (`docs/DESIGN.md`'s meter — pick one
   already sitting in `caution` or `halt` tone from the fixture data, not
   one freshly created at full balance).
2. Point at the meter: "This is the whole permission model. One number,
   how much is left." Do not open the sentence-builder for this shot —
   that's a different, quieter feature, not this moment.
3. Attempt a payment that would exceed the remaining balance (through the
   assistant proposal path if the build has it wired that way by demo day,
   otherwise through the allowance-backed send path).
4. Let it refuse. On screen, not narrated: the refusal has to be the
   contract's, not a toast the app decided to show. If the build state at
   demo time can't yet show a contract-level revert on screen, say so in
   the write-up rather than staging a fake one here — see
   `docs/SECURITY.md`'s own disclosure rule.

## Closing line (1:20–1:30)

One sentence, to camera or as a title card, not over more app footage:

> "The assistant never had the keys. The contract did."

## What NOT to include

- No wallet address, ever, on screen — the hard rule holds in a video the
  same as it holds in the app.
- No mention of "blockchain," "wallet," "gas," "token," "on-chain," or a
  transaction hash in narration, even loosely, even as an aside for a
  technical judge. If a judge wants that detail, that's what
  `docs/SECURITY.md` and the open contract source are for — say so on
  camera instead of saying the word.
- No sped-up settlement. The whole point is that it wasn't sped up.
