# Entole

A money app where an assistant can pay on your behalf, and cannot overspend,
because the limit is enforced by the network rather than promised by the
app.

Built for the Monad Metropolis hackathon, track: Consumer Products &
Payments. Full product thesis in [`docs/PRODUCT.md`](docs/PRODUCT.md).

## The three moments this is built to show a judge

1. A payment leaves Lagos and settles in under a second.
2. An assistant proposes a scheduled transfer and gets cancelled mid-countdown.
3. An allowance refuses to go past its limit — not because the app validated
   the request, but because the contract rejected it.

No vocabulary required for any of the three. If you can tell this is built
on a blockchain while watching it, the design has failed — see
[`docs/PRODUCT.md`](docs/PRODUCT.md)'s product rules.

## Security, in one sentence

The assistant proposes; a contract enforces. Full answer, with the tests
that back it, in [`docs/SECURITY.md`](docs/SECURITY.md).

## Layout

```
apps/mobile      Expo + expo-router. The phone app — the actual submission.
apps/web         Next.js App Router. The same product, over the same store.
packages/core    Money, schemas, allowances, gateway, store. No platform.
packages/tokens  Design tokens and the Tailwind preset.
contracts/       EntolePolicy.sol — the policy contract. Read this first.
indexer/         Envio HyperIndex config for activity and allowance history.
docs/            Product, design, architecture, scope, security.
```

## Status, honestly

What's real and tested:

- **The policy contract, deployed to Monad testnet.**
  `contracts/src/EntolePolicy.sol`, 18 passing tests, live at
  `0xd0c1099827e49C07f264927d0Dd3416eb29EA9b7`. Caps, allow-list,
  per-transaction maximum, expiry, revocation (owner-signed or
  passkey-signed), pause. See [`docs/SECURITY.md`](docs/SECURITY.md).
- **The consumer core**, phone and web: onboarding, send, receive by link,
  allowances (sentence-builder, meter, revoke), the assistant undo-window
  flow, pause reachable from every header, activity feed.
- **A business layer** (seats, invoicing, a tax reserve) riding the same
  allowance primitive — no second trust model. See
  [`docs/SCOPE.md`](docs/SCOPE.md).
- **A Telegram intake adapter, wired end to end.** Message parsing was
  always real and tested; the webhook route now links a chat to an account
  with a one-time code, parses against that account's own contacts, and
  writes the proposal to a server-side inbox that runs the same undo window
  as an in-app assistant action. Unset `TELEGRAM_BOT_TOKEN` still returns
  501, the honest default. See `apps/web/app/api/telegram/webhook/route.ts`.
- **Grow (savings and stocks).** Backed by `GrowthVault`, live on Monad
  testnet at `0x9D904c6a9231F16913ad3A41563dCB07bF9d89bd`, 8 passing tests.
  It holds a real deposit balance and sits outside `EntolePolicy` by design;
  only the depositor can withdraw, and there is no delegate or allowance path
  into it. Stocks stay gated until a broker is configured. See
  [`docs/SECURITY.md`](docs/SECURITY.md).
- **Passkey accounts (Mera)** — `packages/core/passkey.ts`, wired into the
  phone app's onboarding and sign-in. A WebAuthn PRF ceremony's 32 bytes
  *are* the private key; one passkey derives two ("one passkey, many
  keys"): an owner key and a session/delegate key, the exact split
  `EntolePolicy.createAllowance` needs. See
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)'s "Accounts and auth."
- 1077 tests passing across `packages/core` (264, plus one skipped),
  `apps/mobile` (492), `apps/web` (303) and `contracts` (18, plus one that
  self-skips honestly; see `contracts/README.md`), via `pnpm test` /
  `forge test`.

What's disclosed as not finished, the same way the NGN off-ramp always was:

- **The passkey ceremony itself is unverified on real hardware.** The logic
  above it is tested against a stub authenticator (6 tests, deterministic);
  the actual WebAuthn call needs a real relying-party domain
  (`entole.to/.well-known/…`, not hosted anywhere this environment
  controls) and a real device — see `apps/mobile/README.md`.
- **Chainlink CRE condition-gated release is wired end to end** against the
  server store: the callback route re-validates the payload, recomputes the
  FX condition itself through `releaseConditionalInvoice` (never trusting the
  caller's verdict), and marks the invoice released on success. What it still
  needs is a real registered CRE workflow watching an FX feed to POST to it,
  and a `CHAINLINK_CRE_WEBHOOK_SECRET`; unset, the route returns 501.
- **Agora, Aurora Intents, Envio, Nansen** — wrapped behind interfaces
  (`packages/core/gateway.ts`, `indexer/`), none connected to a live account
  yet.

## Running it

```bash
pnpm install
pnpm start        # Expo dev server, phone app
pnpm dev          # Next dev server, web app
pnpm test         # every package
pnpm typecheck
```

Contract tests: `cd contracts && forge test`.

## Bounty claims

See the table in [`docs/SCOPE.md`](docs/SCOPE.md) — claimed only where
genuinely integrated, per that document's own rule: "a thin integration
claimed loudly reads worse than not claiming it."
