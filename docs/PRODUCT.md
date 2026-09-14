# Entole — Product

## One line

A money app where an assistant can pay on your behalf, and cannot overspend,
because the limit is enforced by the network rather than promised by the app.

## The thesis

Delegating money to software requires trust that software has not earned. Every
agentic payments product currently asks the user to believe the model will
behave. Entole removes the question. The assistant proposes; a contract enforces.
If the assistant tries to exceed its allowance, the payment does not fail
politely — it cannot be made.

That is the whole product. Everything else is a consequence of it.

## Who it is for

Nigerians sending and receiving money across borders, and groups sharing costs.
Someone who sends money home monthly, splits rent, pays a supplier abroad, or
receives from family in the diaspora. They have a bank app they distrust, a
WhatsApp group where money gets discussed, and years of experience with transfers
that sit pending.

They are not crypto users. Most will never learn that this is a blockchain
product, and the design succeeds precisely to the degree that they don't.

## Why it can exist now

- Passkey-derived accounts remove seed phrases, which removes the single largest
  onboarding cliff in consumer crypto.
- Monad's P256 precompile makes passkey signature verification cheap enough to
  do on-chain rather than working around.
- Sub-second finality means a payment can be shown as settled while the user is
  still looking at the screen. Against Nigerian bank transfers, this is the most
  visceral advantage the product has.
- Cheap execution makes per-second streaming and fine-grained policy checks
  economic rather than theoretical.

## The three surfaces

One account, three things it does.

**Corridor payments.** Send money across borders. Recipient needs no app and no
account. Settlement is shown with a timestamp, in seconds.

**Allowances.** A rule, written as a sentence, that authorizes the assistant to
pay on your behalf inside a hard limit. Send ₦50,000 to Mom every month, never
more than ₦100,000 a month. The limit is on-chain. The app cannot exceed it and
neither can the assistant.

**Group pots.** Shared money with a terminal state. Members contribute, balances
resolve, the pot settles to zero.

## Product rules

**The blockchain is never mentioned.** Not in copy, not in iconography, not in
error messages. If a user can tell what this is built on, the design has failed.

**Trust is graduated.** New rules confirm every action. After a rule has executed
cleanly several times, offer to let it run on its own. The user watches it behave
before handing over autonomy.

**Delegation always has an undo window, never a confirmation dialog.** Confirming
every assistant action defeats the point of delegation. Executing silently
destroys trust. A countdown with a one-tap cancel is the only pattern that gives
both, and it is a better demo than either.

**The exit is always visible.** Trust in a delegated system comes from a reachable
kill switch, not from reassuring copy.

**Receiving is designed for someone who is not a user.** Corridor products live or
die on the far end of the transfer.

## What success looks like in the demo

A judge watches a payment leave Lagos and settle in under a second, watches an
assistant propose a scheduled transfer and get cancelled mid-countdown, and
watches an allowance refuse to go past its limit. Three moments, no vocabulary
required.
