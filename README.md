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
  `contracts/src/EntolePolicy.sol`, 28 passing tests, live at
  `0xEE9C2cE4FC3a58f88D3E2FCE9807cDcA3A97Ed3e` (redeployed 9 October 2026
  with `executeFor`, so the assistant's runs need no fee balance). Caps,
  allow-list, per-transaction maximum, expiry, revocation (owner-signed or
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
  into it. See [`docs/SECURITY.md`](docs/SECURITY.md).
- **Stocks, to look at.** Both apps list the shares that can be held on Monad
  (the issuer's own catalogue) with the exchange's price, the day's change, a
  month of closes, volume, company value and the range over a year. All of it
  is read live through `/api/stocks`; nothing is written into the app, and a
  source that cannot be reached shows as "can't show stocks right now", never
  as an older figure. Shares named after a coin are left off the list, and a
  company's description is left out when it talks about them. Buying is not
  open: the Buy button is there and cannot be pressed. The prices come from the
  exchange's website endpoints, which are not a contracted feed. See
  `packages/core/stock-market.ts`.
- **Savings that earn, on the main network.** There, savings go straight from
  the person's account into Aave's AUSD vault and earn what borrowers pay,
  about 3.3% a year when checked on 10 October 2026. The app shows a rate or
  earnings only when it has read them from that vault; on the test network
  nothing pays, and the screen says savings do not earn interest yet. Proven
  against the real vault on a copy of mainnet
  (`packages/core/savings.fork.test.ts`, `contracts/test/MainnetFork.t.sol`);
  not yet used with real money.
- **Passkey accounts (Mera)** — `packages/core/passkey.ts`, wired into the
  phone app's onboarding and sign-in. A WebAuthn PRF ceremony's 32 bytes
  *are* the private key; one passkey derives two ("one passkey, many
  keys"): an owner key and a session/delegate key, the exact split
  `EntolePolicy.createAllowance` needs. See
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)'s "Accounts and auth."
- 1307 tests passing across `packages/core` (320, plus one skipped),
  `apps/mobile` (505), `apps/web` (428) and `contracts` (54, plus two that
  self-skip honestly; see `contracts/README.md`), via `pnpm test` /
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

## How this was built

**AI coding tools.** Claude Code (Anthropic) was used throughout this
project to write, test and review code and documentation.

**Pre-existing work.** The only components that predate this project are the
third-party open-source packages it depends on, listed in each
`package.json` and in `contracts/lib` — chiefly Expo and React Native,
Next.js, NativeWind and Tailwind, viem, Zod, Mera (`@category-labs/mera`),
`react-native-passkey`, Envio HyperIndex and Foundry's `forge-std`. Everything
else in this repository was written for the hackathon; the first commit is
dated 14 September 2026.

## License

MIT. See [`LICENSE`](LICENSE).

## Bounty claims

See the table in [`docs/SCOPE.md`](docs/SCOPE.md) — claimed only where
genuinely integrated, per that document's own rule: "a thin integration
claimed loudly reads worse than not claiming it."
