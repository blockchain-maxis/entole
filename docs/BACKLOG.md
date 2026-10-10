# Backlog

Things decided, deferred, or known to be missing. Nothing here is hidden in the
product: where it touches a screen, the screen says so plainly.

## Deferred by decision

- **WhatsApp and OAuth-style connections.** Telegram is connected from Me,
  Connections, with a one-time `/link CODE` (not OAuth). WhatsApp is not built:
  its business API needs approval that does not fit the window.
- **Bank cash-out.** Beneficiaries can carry bank details, recorded for later.
  Nothing uses them to move money until an off-ramp partner is integrated
  (Mercuryo is a Metropolis sponsor with an on/off-ramp — untested here).
- **Payroll from Google Sheets.** Business payroll ships with CSV import first.
  Sheets needs Google OAuth credentials and a consent screen.
- **Global currencies.** The product is for any country. Today the account
  currency is naira, with the live USD→NGN rate. A currency/country step,
  `formatMoney(minor, currency)` and per-currency rates are the next money pass.
- **Profile photo upload.** Needs an image-picker native module, so it waits for
  the next dev-client rebuild (batch it with the CSV document picker).

## Known gaps in what exists

- **The standing approval is additive and never shrinks.** Creating an
  allowance has the owner approve `current + (cap x periods)` to the policy,
  because the policy draws with `transferFrom`. Every allowance shares that one
  approval, and revoking one does not lower it. The caveats still bound every
  draw; the leftover is headroom, not authority. A "reset approval" action is
  the upgrade.
- **The undo window is not enforced on-chain.** It is a countdown in the app
  before the assistant's run is submitted. Nothing in the contract delays it.
- **Records live on the device.** Beneficiaries, allowances, seats, invoices and
  the send ledger are per-device. A backend (or the Envio indexer for history)
  is the upgrade path; `RecordStore` in core is the seam. The assistant inbox,
  directory and Telegram links are server-side (Upstash Redis).
- **Seats are records, not on-chain grants.** A team member has no account to
  sign with, so the contract cannot enforce a seat. They persist on the device
  and show on web only: the phone Business tab dropped seats on purpose (a
  hard-rules test holds that).
- **Tax reserve is display only.** `settleInvoice` returns no reserve; nothing
  creates one in the live app. The invoice CSV export covers the bookkeeping.
- **Bill payment has no automatic refund.** The person's payment settles before
  the biller is paid. If the biller then refuses, the route answers
  `bill_failed`, logs `[bills] paid-not-billed hash=...`, and the payment has to
  be returned by hand from the bills account.
- **A chain deposit target cannot be shown.** Aurora's route returns an address
  on another chain, which the hard rules forbid rendering. `/api/aurora/deposit`
  returns it as `qrPayload` for a QR or a copy button; no screen uses it yet.
  Whether a QR-only screen counts as rendering an address is a product call.
- **Adding real money is built but not proven with real money.** It only runs
  on the main network; none of the partners reach the test network.
  - **From another app.** The person picks what they are sending (AUSD, USDC or
    MON on Monad; USDC on Base, Arbitrum or Ethereum) and gets a scan code.
    Relay converts what arrives into the account's own money, and returns it to
    the sender if it cannot. Every route was priced live on 10 October 2026; no
    real transfer has been sent through. USDT on Tron, the commonest way people
    here hold dollars, is not offered yet: it needs a Tron account of ours for
    refunds. Solana needs a Relay key.
  - **Card.** Opens Relay's card page with the account set. $20 minimum. Its
    own confirmation step shows the account as an address; that page is theirs.
  - **Bank transfer in naira** is "coming soon". Onramp.money's public app id
    ignores the address passed in and asks the person to type one (seen in a
    browser, 10 October 2026), so it needs our own app id, which means their
    business check. The code is finished and priced live (`packages/core/onramp.ts`).
    A failed conversion there returns to `ONRAMP_REFUND_ADDRESS` and has to be
    passed back by hand.
  - Sending something other than what was picked to a scan code may not arrive.
    The screen says so, but nothing prevents it.
- **Savings ("Grow") has no yield source.** `GrowthVault` is deployed and
  tested, but accrual is display-only. The screens show no projected earnings
  until a real source exists.
- **Stocks** stay gated behind broker credentials that must live on a server.
- **No iOS passkeys** until an Apple Team ID exists.

### Fixed in this pass

- The assistant now pays through the sponsor: it signs an EIP-712 `Execute`, the
  sponsor submits `executeFor`, so its key needs no network-fee balance. If the
  sponsor route is missing it falls back to topping the key up and paying itself.
- `createAllowance` cannot be hijacked: an id belongs to its first owner, and a
  replace clears the old recipient list.
- Rate limiting is shared through Redis when it is configured (and per address
  on `/api/gas`); the in-memory limiter is only the dev and test fallback.
- The server store refuses to start in production without Redis, link codes
  expire after 15 minutes, and the Telegram webhook checks its secret.
- An on-request allowance no longer overflows when created.

## Waiting on credentials

Every key is listed, with where it goes and how to check it, in `docs/ENV.md`.
Each integration is finished in code and answers 501 (or shows "not available
yet") until its key exists.

- `UPSTASH_REDIS_REST_URL` / `_TOKEN`: required in production for the store,
  the directory and the shared rate limiter.
- `SPONSOR_PRIVATE_KEY`, funded: relayed sends, assistant runs and gas top-ups.
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`, then
  `pnpm --filter @entole/web telegram:webhook https://<domain>`.
- `ENVIO_API_TOKEN`: hosted HyperIndex for activity history.
- `AGORA_ACCESS_KEY`, `AURORA_INTENTS_API_KEY`, `NANSEN_API_KEY`,
  `CHAINLINK_CRE_WEBHOOK_SECRET` (see `docs/CRE.md`), `QWEN_API_KEY`.
- `BILL_PAYMENT_API_KEY`, `BILL_ITEM_CODES` and `NEXT_PUBLIC_ENTOLE_BILLS_ADDRESS`
  (the account bills are paid into) for Pay a bill.
- Apple Team ID for the iOS `apple-app-site-association` file.
- `NEXT_PUBLIC_ONRAMP_URL_TEMPLATE`: the fiat on-ramp partner for checkout links
  (`apps/web/lib/onramp.ts`).

Three integrations are best-effort until their first live call, and their
endpoint paths are environment variables so a mismatch is fixed without code:
Aurora (`AURORA_INTENTS_API_BASE`, `_DEPOSIT_PATH`), Nansen (`NANSEN_API_BASE`,
`_NETFLOW_PATH`) and Flutterwave (`BILL_PAYMENT_API_BASE`, `BILL_VALIDATE_PATH`,
`BILL_PAY_PATH`).

## Going to mainnet

- Agora AUSD on Monad mainnet: `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`
  (chain 143, 6 decimals). Redeploy `EntoleRouter` against it and change the
  token and router addresses in config; `EntolePolicy` needs no change.
- Remove the test faucet routes. Replace `/api/gas` with real sponsorship (account abstraction or a paymaster).
- Fee treasury becomes a dedicated multisig, not the deployer.
- An independent audit of `EntolePolicy`, `EntoleRouter` and `GrowthVault` before
  real money. The tests are thorough; they are not an audit.
