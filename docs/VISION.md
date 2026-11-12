# Entole — Vision

The long-term direction, in the founder's words and broken into buildable
parts. Written 12 November 2026. `docs/PRODUCT.md` is the thesis (an assistant
that pays inside limits enforced on-chain); this file is where that thesis is
going. Hackathons are checkpoints on this road, not the end of it.

## In the founder's words

> I want a bank, a financial friend and an educated assistant.

> Because I am a dev, and I'm always afraid of my finances like mad, every big
> payment seems like a bad investment but then I rack up small dumb payments
> that would eventually finish my funds. If I have an assistant that is always
> helping me with everything financially related and is so tailored
> specifically for me, I would be very happy.

The first user is the founder: a Nigerian developer, irregular income (often
in foreign currency), afraid of big spends, leaking money through small ones,
paying for foreign subscriptions (AI tools) that should not need manual
attention. Build for that person first; it generalises to most of the people
in `docs/PRODUCT.md`.

## The three roles

### 1. The bank — holds and moves money

What a Nigerian bank with multiple currencies does.

| Capability | Where it stands |
|---|---|
| Account, passkey sign-in, no phrase | Built, live |
| Send / receive by username or phone, across borders | Built, live |
| Add money: card, from another app, Tron/Solana | Built, not proven with real money |
| Savings with a real rate (Aave `waMonAUSD`) | Built, env not set, mainnet only |
| Stocks | Browse only, live data; buying blocked on issuer/broker approval |
| Bills (airtime, power, data…) | Built |
| Business: invoices, payroll import, tax reserve | Built (tax reserve is a flat 20%) |
| **Several currencies held side by side** (USD, USDT, EUR…) | Not built — NEAR Intents is the fit |
| **Swap between them at a quoted rate** | Not built — NEAR Intents 1Click |
| **Pay out to whatever network the receiver uses** | Not built — NEAR Intents |
| Cash out to a Nigerian bank account in naira | Not built — needs a licensed partner |
| Own naira account number to receive bank transfers | Not built — needs a licensed partner |
| Dollar card for foreign subscriptions | Not built — needs a card issuer partner |

### 2. The financial friend — knows where you stand, advises for you

Advice built from the person's own numbers, never generic internet advice,
never made-up figures (the "no mock, no hard-coded, no fake data" rule from
Stocks applies to every number the friend shows).

1. **Money picture.** Income (when, how regular, which currency), fixed costs,
   subscriptions, spending by kind, savings, runway in months. From in-app
   activity first; bank statement import (CSV/PDF from Nigerian banks) next;
   open banking (e.g. Mono) later.
2. **Safe to spend.** One number for today: balance minus upcoming bills,
   savings target and tax set-aside. The answer to "am I okay?".
3. **Small-leak detector.** Groups small payments over a week or month and
   says what they add up to against income ("14 small payments, ₦38,000, 9% of
   this month").
4. **Big-payment check.** "Can I afford this?" — what it does to runway, how
   long to earn it back, which goal it delays. Answers the fear of big
   payments with numbers instead of dread.
5. **Adaptive saving.** When spending runs under the usual, the difference is
   offered to savings; when income lands, a share is offered too. Runs as an
   allowance, so the assistant moves it inside a limit the person set.
6. **Investing nudges.** Only from live figures (savings rate, stock prices)
   and the person's own runway: "you have 7 months of runway and ₦X idle;
   savings pays 3.3% now". Education and options, the person decides. Needs a
   compliance read before anything that looks like investment advice.
7. **Tax.** Personal income tax estimate under the current Nigerian rules
   (Nigeria Tax Act 2025, in force 2026 — bands to be confirmed by
   `entole-compliance`), foreign income, a real set-aside instead of a flat
   20%, filing reminders.
8. **Monthly check-in.** What came in, what went out, what changed, one thing
   to do next.
9. **Memory.** Goals, preferences, what the person said no to — so advice is
   about them and does not repeat.

### 3. The assistant — does the work

Ayo, inside allowances, as now: proposes, the contract enforces, the person
can always pause.

- Bills on autopay, each one an allowance with a remaining balance.
- Subscriptions, including foreign ones (AI tools): needs the dollar card;
  each subscription becomes its own capped allowance.
- Payroll and invoices for people who run a small business.
- Reminders of opportunities and deadlines: a better savings rate, income
  arrived, tax filing date, a subscription about to renew that is not used.
- Turns the friend's suggestions into allowances on a yes ("save ₦10,000 every
  Friday when spending is under budget, never more than ₦40,000 a month").

## Where NEAR Intents fits

NEAR Intents is the bank's foreign exchange desk and correspondent network.
Already in the code: Tron/Solana deposits through Aurora/1Click, failed ones
held in the person's own NEAR Intents account (`refundType: 'INTENTS'`), and
"Bring it in" (`packages/core/intents-held.ts`). The account on NEAR Intents is
named by the same address as the Entole account, so nobody is asked for
anything new.

Deeper uses, in order of value to the person:

1. **Currencies held side by side** in that Intents account, shown as pockets.
2. **Swap between pockets** at a 1Click quote, real state shown, no optimism.
3. **Pay out anywhere**: the receiver gets what they use (USDT on Tron, USDC on
   Solana…) without either side choosing a network.
4. **Assistant-proposed swaps and moves inside an allowance** — the thesis,
   applied to currency.

Blocker held by the founder: `ONECLICK_API_KEY` (and `AURORA_INTENTS_API_KEY`).
Main network only; there is no test network.

## Order

Each step is used by the founder on their own money before the next.

1. **Intents pockets + swap + pay-out anywhere** (bank) and **money picture +
   safe to spend + small-leak detector** (friend), with Ayo able to talk about
   both. Pure logic in `packages/core`, both apps render it.
2. Statement import, subscription finder, big-payment check, adaptive saving
   as an allowance, tax estimate with real bands, monthly check-in, memory.
3. Partner-gated: naira cash-out and account number, dollar card for
   subscriptions, stock buying, open banking, payroll with PAYE remittance,
   KYC tiers. Owned by `entole-bd` and `entole-compliance`.

All hard rules in `CLAUDE.md` still bind: no addresses, no forbidden words
("pockets" and "currencies", not tokens), no optimistic settlement, every
assistant capability is an allowance with a remaining balance.

## Revamp map (12 November 2026)

Every part of the project, what it is today, and what the revamp does to it.

| # | Part | Today | Revamp |
|---|---|---|---|
| 1 | Account and safety | Passkey, lock, pause, `EntolePolicy` (allowances, P256), `EntoleRouter`, sponsored fees | Keep. It is the thesis. |
| 2 | Data layer | `onchain-gateway.ts` (2,200 lines), `store.tsx`, records on Upstash, Envio index (expires ~11 Dec) | Keep; split the gateway; the index expiry is a standing risk |
| 3 | Money in | Relay (card, other app), Aurora Tron/Solana, Onramp.money (coming soon), Agora mint/redeem, faucet | One Add money; NEAR Intents the main rail for money from other networks |
| 4 | Money out | Send by username/phone, abroad, bank, pay links, beneficiaries, receipts, bills | Keep; add pay-out-anywhere (Intents); naira cash-out is partner-gated |
| 5 | Currencies | One (AUSD) | New: pockets on NEAR Intents, swap at a 1Click quote |
| 6 | Grow | Aave savings (env unset), `GrowthVault`, stocks browse | Folded into the friend: saving and investing driven by your numbers |
| 7 | Business | Invoices, pay supplier, payroll import/run, flat 20% tax reserve, CSV, Chainlink CRE FX gate | Keep; invoices payable from any network via 1Click; real tax bands |
| 8 | Ayo | Brain, actions, persona, voice, evals, inbox, Kimi, rules, Telegram intake, help bot | Gains memory and the financial profile; private model (NEAR AI Cloud, TEE) to weigh |
| 9 | Financial friend | Does not exist | New: PDF statement import, categories, money picture, safe to spend, small leaks, big-payment check, adaptive saving, tax, check-in |
| 10 | Sponsor leftovers | Nansen corridor line, Chainlink CRE, Agora, Envio | Each kept only if it does a real job; Nansen's line is the weakest |
| 11 | Surfaces | Expo phone app, web PWA, Telegram | Push notifications missing: needed for reminders |

Navigation today: Home, Pay, Business, Grow, Me. Proposed: Home (safe to
spend + Ayo), Money (pockets, add, cash out), Pay, Plan (the friend: picture,
savings, investing, tax), Me (business switch inside). Designed before built.

### NEAR hackathon cut (see memory `near-hackathon`)

Only work after `3031b7c` is judged. Tracks: Real-World Money + Privacy &
Private AI (Agent Economy optional).

1. Private financial friend: PDF statement → NEAR AI Cloud model in a TEE →
   money picture, safe to spend, small leaks; attestation shown as a "checked"
   panel; nothing kept on the server.
2. Currencies on NEAR Intents: pockets, swap, pay out anywhere, invoices paid
   from any network.
3. Ayo acts on both inside an allowance.
4. README with baseline/in-window split, `pre-hackathon` and
   `hackathon-submission` tags, X post, NEAR account for the prize.
