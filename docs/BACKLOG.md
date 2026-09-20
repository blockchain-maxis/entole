# Backlog

Things decided, deferred, or known to be missing. Nothing here is hidden in the
product: where it touches a screen, the screen says so plainly.

## Deferred by decision

- **Connect social accounts** (Telegram, WhatsApp and similar) from Me →
  Connections. Wanted, not built. The Telegram intake module exists in core;
  the settings surface and OAuth do not.
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

- **Assistant payments still need a network fee balance.** Ordinary sends are
  gasless (one signature through `EntoleRouter`). An allowance-gated payment is
  submitted by the assistant's own key, which holds no MON. Fix: top the
  assistant key up through `/api/gas` before its first payment, or add a relay
  path to the policy contract.
- **Nothing calls `approve` on the settlement token.** `EntolePolicy.execute`
  draws with `transferFrom`, which needs the owner to have approved the policy.
  AUSD supports signed approvals; the owner should sign one when creating an
  allowance and the sponsor submit it.
- **Rate limiting is per-process memory** on the sponsor routes. Fine for a test
  network; production needs a shared store (KV) and abuse checks beyond IP.
- **`/api/gas` sends a small amount of MON to any address that asks**, capped by
  a per-IP limit and a reserve on the sponsor. Production replaces this with
  account abstraction / a paymaster.
- **Records live on the device.** Beneficiaries, allowances and the send ledger
  are per-device. A backend (or the Envio indexer for history) is the upgrade
  path; `RecordStore` in core is the seam.
- **Savings ("Grow") has no yield source.** `GrowthVault` is written and tested
  but not deployed, and accrual is display-only. The screens show no projected
  earnings until a real source exists.
- **Stocks** stay gated behind broker credentials that must live on a server.

## Waiting on credentials

- `ENVIO_API_TOKEN` — hosted HyperIndex for activity history.
- Agora API access key — mint/redeem routes (the settlement token itself is
  Agora's AUSD and works without it).
- Aurora Intents, Nansen, Chainlink CRE, and Qwen/Kimi/Hunyuan keys — each is a
  self-contained bounty integration, gated off until its key exists.
- Apple Team ID for the iOS `apple-app-site-association` file (Android-only
  passkeys today).

## Going to mainnet

- Agora AUSD on Monad mainnet: `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`
  (chain 143, 6 decimals). Redeploy `EntoleRouter` against it and change the
  token and router addresses in config; `EntolePolicy` needs no change.
- Remove the test faucet routes. Replace `/api/gas` with real sponsorship.
- Fee treasury becomes a dedicated multisig, not the deployer.
