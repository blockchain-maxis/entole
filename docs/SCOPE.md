# Entole — Scope

Submission 13 October 2026. Judging 14–27 October. This revision is written on
17 September 2026, 26 days out. The original six-week plan assumed a 1
September start and no business layer; neither held. Everything below is
replanned from today, not from week one — see "Where we actually are."

Submitted work must be built during the window and verifiable as such. Fresh
repo, clean commit history, dated tags. This is an advantage, not a burden.

## Where we actually are

- The consumer-core UI (home, rule builder, allowance detail, send, receipt,
  receive, assistant undo sheet, onboarding) is substantially built on the
  phone and fully built on web, against a mocked gateway.
- The policy contract — the actual product thesis — does not exist yet. No
  Solidity, no deploy. This was a week-two, must-not-slip item and it slipped.
  It is now the single highest-priority piece of work, ahead of any business
  layer feature.
- The passkey account (Mera or Privy) was never decided or built. `signIn()`
  today is a bare device biometric gate with no key derivation and no account
  behind it — closer to a screen lock than to auth. This blocks the contract
  work too, since enforcement needs a real signer to check.
- The mobile hard-rules test suite is failing today: four placeholder tabs
  (`invest`, `lifestyle`, `transfer`, `me` — leftover Expo scaffold, not in the
  screens table below) don't render the shared header, so the pause control
  is unreachable from them. Fix before anything else — it's a one-line-per-file
  fix and the hard rule is not negotiable.
- `app/pause.tsx` doesn't exist on mobile at all. Web has it; the phone, which
  is still the actual submission, does not.

## In scope — consumer core (unchanged, this is the submission's spine)

- Passkey onboarding, no seed phrase
- Send to a contact, settle, receipt
- Receive by link, no app required on the far end
- Allowances: create as a sentence, enforce on-chain, view, revoke
- Assistant proposes a payment inside an allowance, with an undo window
- Pause everything, from any screen
- Activity feed distinguishing assistant actions from user actions
- A web app, as a separate Next.js build over the shared core. The phone demo
  is still the submission, and the web app is not allowed to cost it a day.

## In scope — business layer (added 17 September 2026)

Added at the user's direction, from a broader B2B cross-border pitch. Every
item here reuses the allowance primitive and the policy contract's caveat
model as-is. None of it introduces a second trust model, a second account
type, or a second contract. If a pitch idea would have required that, it was
cut below instead.

- **Business account with seats.** Owner, Admin, Officer (capped allowance),
  Bookkeeper (read-only). A seat is an allowance granted to a person instead
  of to the assistant — same contract call, same meter component, same undo
  window on anything an Officer initiates over a threshold.
- **Invoicing.** One-click invoice generation with a settlement link — this
  reuses the receive-by-link flow that already exists, not a new surface.
  CSV export with the FX rate at time of receipt. No QuickBooks/Xero two-way
  sync: that needs OAuth certification with each platform, which does not fit
  in 26 days. Export only.
- **Tax reserve.** Splits a fraction of an incoming invoice payment at source
  into a separate allowance the business can't casually spend from, paid out
  on a fixed date. This is earmarking, not investment — no yield is attached
  to it, which keeps it inside the no-yield rule below rather than breaking it.
- **Telegram as a second intake surface.** A thin adapter that parses a
  message into the same proposal object the app already produces, then runs
  the same undo window before settling. Chosen over WhatsApp and Slack — see
  "Cut from the pitch."
- **One Chainlink CRE-gated release.** Already planned as bounty priority #1
  in `docs/ARCHITECTURE.md`; the business layer just gives it a concrete
  use case (release on an invoice-paid webhook).

## Cut from the pitch, and why

- **Idle-balance yield / autonomous treasury routing into lending protocols.**
  Contradicts the no-yield rule below directly, and a real integration is not
  credible in 26 days that now also need to fund a policy contract from
  scratch. A faked accrual number reads worse than not claiming it — cut
  entirely, not mocked, not demoed.
- **WhatsApp.** Business API approval timelines don't fit the window.
  Telegram tells the same "a message replaces a form" story without the
  approval dependency.
- **Slack.** Same OAuth app-review problem, and a weaker demo story than
  Telegram for a Nigeria-first corridor product. Cut.
- **Two-way accounting sync (QuickBooks/Xero).** Needs per-platform OAuth
  certification. CSV export covers the same judging moment for less risk.
- **General N-of-M multi-sig.** The seat model already gives per-person spend
  limits without a new signature scheme. Don't build a second one.

## Out of scope

Say no to all of these. If one becomes tempting in the final week, the answer
is still no.

- NGN off-ramp (mocked behind an interface)
- KYC beyond what a demo needs
- Multiple corridors — one is enough to prove the model
- Card issuing
- Savings, yield, or interest — see "Cut from the pitch"
- Push notifications
- Multi-language
- Anything requiring App Store review

## Order of work

Replanned from 17 September. Dated, not numbered by week, since we are
starting mid-plan.

**17–21 Sep.** Passkey spike on real Android, decide Mera or Privy and commit
— this was never actually done and blocks everything downstream of it. Fix
the failing hard-rules tests (the four scaffold tabs). Build `app/pause.tsx`
on mobile. Start the policy contract — caps, allow-list, per-transaction
maximum, expiry, revocation — tests first.

**22–26 Sep.** Finish and deploy the policy contract to Monad testnet. Wire a
real `PaymentsGateway` implementation for send, allowance create/revoke, and
pause against it, behind the same interface `demoGateway` already defines.
This is the product; if it slips, everything after it slips.

**27 Sep–1 Oct.** Corridor end to end against the real contract: send,
settle, receipt, receive by link. Assistant proposal and undo window wired to
real enforcement, not the mock. **Consumer-core feature freeze at the end of
this sprint.**

**2–6 Oct.** Business layer: seats, invoicing, tax reserve, Telegram intake.
**Business-layer feature freeze at the end of this sprint.**

**7–10 Oct.** Bounty integrations in priority order, dropping any that
resists. Envio-backed activity.

**11–13 Oct.** Polish, demo video, write-up, security section. No new
features.

## Bounty claims

Track: Consumer Products & Payments ($30,000).

| Bounty | Value | Requires |
|---|---|---|
| Agora — cross-border payments | $10,000 | AUSD settlement via routes API |
| Aurora Intents | $5,000 | Any-chain funding into Monad |
| ~~Privy or Dynamic~~ | $5,000 | Dropped — accounts are Mera passkeys |
| Nansen | $5,000 | Corridor flow intelligence |
| Mera — one passkey, many keys | $2,500 | Passkey-derived session keys |
| Mera — best UX | $2,500 | Passkey onboarding |
| MetaMask — agent wallet plugin | $2,500 | ERC-7715/7710 scoped permissions |
| Chainlink CRE | $3,000 | Condition-gated payment workflow |
| Envio | $1,000 | HyperIndex for activity |
| Qwen / Kimi / Hunyuan | credits | Assistant intent parsing |

Bounties are additive to the track prize. Claim only what is genuinely
integrated. A thin integration claimed loudly reads worse than not claiming it.

## Kill criteria

Decide fast, do not agonise.

- Mera PRF unreliable on target Android by 21 Sep → Privy, drop two Mera
  bounties, move on the same day.
- Policy contract not live on Monad testnet with caps, allow-list, expiry and
  revocation working by 26 Sep → cut the business layer entirely, ship
  consumer core only. This is the deadline that protects the submission;
  treat it as load-bearing.
- Agora API blocking by 1 Oct → settle in USDC, forgo the Agora bounty rather
  than delay.
- Business layer not usably demoable by 6 Oct → cut whichever piece is
  weakest (Telegram intake first, then tax reserve, then seats) rather than
  ship all of it half-built.
- Anything not working by 10 Oct → it does not ship.

## What the submission needs

A working phone demo, not a mockup. Judges reward "it works today". Three
moments: a payment settling in under a second, an assistant action cancelled
mid-countdown, an allowance refusing to exceed its cap.

An explicit security section answering one question: how do we know the
assistant cannot drain you. Open-source the policy contract.

And the corridor story, told by someone who lives in it. That is the part
nobody else in the room can fake.
