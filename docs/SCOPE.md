# Entole — Scope

Six weeks. Submission 13 October 2026. Judging 14–27 October.

Submitted work must be built during the window and verifiable as such. Fresh
repo, clean commit history, dated tags. This is an advantage, not a burden.

## In scope

- Passkey onboarding, no seed phrase
- Send to a contact, settle, receipt
- Receive by link, no app required on the far end
- Allowances: create as a sentence, enforce on-chain, view, revoke
- Assistant proposes a payment inside an allowance, with an undo window
- Group pot with a settle-to-zero terminal state
- Pause everything, from any screen
- Activity feed distinguishing assistant actions from user actions
- A web app, as a separate Next.js build over the shared core. Added 3 September
  2026; it was out of scope before that. The phone demo is still the submission,
  and the web app is not allowed to cost it a day.

## Out of scope

Say no to all of these. If one becomes tempting in week four, the answer is
still no.

- NGN off-ramp (mocked behind an interface)
- KYC beyond what a demo needs
- Multiple corridors — one is enough to prove the model
- Card issuing
- Savings, yield, or interest
- Push notifications
- Multi-language
- Anything requiring App Store review

## Order of work

**Week 1.** Passkey spike on real Android. Decide Mera or Privy and commit.
Scaffold Expo and expo-router. Wire design tokens. Nothing else.

**Week 2.** Policy contract: caps, allow-list, expiry, revocation. Tests first.
This is the product; if it slips, everything slips.

**Week 3.** Send, settle, receipt. Receive by link. The corridor works end to
end.

**Week 4.** Allowances in the UI. Sentence builder. Assistant proposal with undo
window. **Feature freeze at the end of this week.**

**Week 5.** Group pots. Bounty integrations in priority order, dropping any that
resists. Envio-backed activity.

**Week 6.** Polish, demo video, write-up, security section. No new features.

## Bounty claims

Track: Consumer Products & Payments ($30,000).

| Bounty | Value | Requires |
|---|---|---|
| Agora — cross-border payments | $10,000 | AUSD settlement via routes API |
| Aurora Intents | $5,000 | Any-chain funding into Monad |
| Privy or Dynamic | $5,000 | Embedded wallet + delegated signer |
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

- Mera PRF unreliable on target Android by end of week 1 → Privy, drop two Mera
  bounties, move on the same day.
- Agora API blocking by end of week 3 → settle in USDC, forgo the Agora bounty
  rather than delay.
- Policy contract not done by end of week 2 → cut group pots entirely.
- Anything not working by end of week 5 → it does not ship.

## What the submission needs

A working phone demo, not a mockup. Judges reward "it works today". Three
moments: a payment settling in under a second, an assistant action cancelled
mid-countdown, an allowance refusing to exceed its cap.

An explicit security section answering one question: how do we know the
assistant cannot drain you. Open-source the policy contract.

And the corridor story, told by someone who lives in it. That is the part
nobody else in the room can fake.
