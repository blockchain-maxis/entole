# Entole

A money app where an assistant can pay on your behalf, and cannot overspend,
because the limit is enforced by the network rather than promised by the
app.

Built for the Monad Metropolis hackathon, track: Consumer Products &
Payments. Full product thesis in [`docs/PRODUCT.md`](docs/PRODUCT.md).

## Try it

**[entole.pro](https://entole.pro)**, in a phone browser or on a desktop. On a
phone it can be added to the home screen and then opens like any other app. It
runs on Monad's test network with test money; nothing in it is real money.

1. **Make an account.** Type a name, then confirm with your fingerprint, face
   or screen lock. That is all of it: no email, no password, nothing to write
   down.
2. **Add money.** Add money, then "Add test money". It arrives in seconds.
3. **Pay someone.** Send takes a username: type `@theirname`, enter an amount,
   confirm with your fingerprint, and watch it settle. Receive shows your own
   username and a link made from it, `entole.pro/pay/@yourname`. To have
   someone to pay, make a second account in another browser or on another
   device. On the receipt, save them under a name.
4. **Let the assistant pay, inside a limit.** Me, then Assistant, and turn it
   on. Set an allowance for the person you saved, then ask in a sentence:
   "Pay 5000 to Ada for rent". You get ten seconds to stop it. Ask for more
   than the allowance has left and it is refused by the contract, not by the
   app.
5. **Talk to it.** With the assistant on, a microphone sits beside its chip at
   the top of every page. Tap it and say, or type, "send 5,000 to" and a
   username, or "what's my balance". It opens the screen and fills it in. It
   cannot confirm: that is still your fingerprint. Speaking and being spoken
   to work in the browser. In the phone app as built today you type to it;
   the two packages that let it listen and speak go in with the next build.
6. **Stop it.** The Assistant chip at the top of every page pauses it at once.

Accounts have been made and used by hand on an Android phone and in a desktop
browser. A device whose passkeys cannot do what an account needs is told so,
and no account is made. Opening an existing account from a second device ("I
already have an account") is built and not yet tried on real devices.

### Contracts on Monad testnet

| | Address |
|---|---|
| `EntolePolicy` (allowances, limits, pause, the undo window) | `0x0d57a7713123C52f2Bfa513F71Ea811f61e67C33` |
| `EntoleRouter` (payments and the fee) | `0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01` |
| `GrowthVault` (savings on the test network) | `0x9D904c6a9231F16913ad3A41563dCB07bF9d89bd` |
| AUSD, Agora's own test deployment | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` |

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
  `contracts/src/EntolePolicy.sol`, 47 passing tests, live at
  `0x0d57a7713123C52f2Bfa513F71Ea811f61e67C33` (version 2, 15 October 2026: the undo
  window is held by the contract, so a stolen assistant key cannot skip it). Caps,
  allow-list, per-transaction maximum, expiry, revocation (owner-signed or
  passkey-signed), pause. See [`docs/SECURITY.md`](docs/SECURITY.md).
- **The consumer core**, phone and web: onboarding, send, receive by link,
  allowances (sentence-builder, meter, revoke), the assistant undo-window
  flow, pause reachable from every header, activity feed.
- **The money is Agora's AUSD, shown in naira.** On the test network the app
  holds and sends Agora's own test AUSD, and "Add test money" draws it from
  Agora's faucet. Agora's mint and redeem API (`AGORA_ACCESS_KEY`) is written
  and not connected.
- **A business layer** (invoices with a payment link, paying a supplier, a
  staff list to pay from on the phone) riding the same account. Seats and
  supply requests were taken off the screens, and the tax reserve only
  displays; [`docs/BACKLOG.md`](docs/BACKLOG.md) says why.
- **History that follows the account (Envio HyperIndex).** `indexer/` keeps
  every payment through the router and inside an allowance. It runs on
  Envio's hosted service and both apps read from it, so a device that has
  never seen an account shows what it sent and received. Checked on a local
  build against the live index: pay, wipe everything the browser kept, sign
  back in, and the payment is there. Money that arrives is also kept by the
  server, which checks each settled payment against the network, so the
  person paid is told at once and sees the sender's note.
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
- **Passkey accounts (Mera)** — `packages/core/passkey.ts`, wired into
  onboarding and sign-in in both apps. A WebAuthn PRF ceremony's 32 bytes
  *are* the private key; one passkey derives two ("one passkey, many
  keys"): an owner key and a session/delegate key, the exact split
  `EntolePolicy.createAllowance` needs. Nothing about the account is kept on
  a server, so the passkey alone opens it again, on the same device or
  another. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)'s "Accounts
  and auth."
- 2346 tests passing: `packages/core` (696, plus five skipped), `apps/mobile`
  (749), `apps/web` (839), `contracts` (54, plus four that self-skip
  honestly; see `contracts/README.md`) and `indexer` (8), via `pnpm test`,
  `forge test` and `pnpm --filter @entole/indexer test:handlers`. Counted on
  13 October 2026.

What's disclosed as not finished, the same way the NGN off-ramp always was:

- **Passkeys are proven by use, not by a test.** The logic above the
  ceremony is tested against a stub authenticator; the ceremony itself has
  been done by hand on an Android phone and in a desktop browser. Opening an
  account from a second device has not been tried on real devices, and the
  phone app has no iOS passkeys until an Apple Team ID exists. A new device
  brings the account, its money and its payments (read from the index, so
  without the notes people wrote); saved people and allowances stay on the
  device they were made on.
- **Everything runs on the test network.** Adding real money, savings that
  earn and money in from other networks are written for the main network and
  have not been used with real money.
- **Chainlink CRE condition-gated release is wired end to end** against the
  server store: the callback route re-validates the payload, recomputes the
  FX condition itself through `releaseConditionalInvoice` (never trusting the
  caller's verdict), and marks the invoice released on success. What it still
  needs is a real registered CRE workflow watching an FX feed to POST to it,
  and a `CHAINLINK_CRE_WEBHOOK_SECRET`; unset, the route returns 501.
- **Nansen** — written behind an interface (`/api/nansen`) and not connected
  to a live account.
- **Aurora Intents** — money in from USDT on Tron and USDC on Solana. The
  server side is written against the live service
  (`packages/core/aurora-intents.ts`, `/api/aurora/deposit`); no screen offers
  it yet and nothing has been sent through it. Main network only.

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
