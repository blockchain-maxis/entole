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

- **The policy contract changed on 15 October 2026 (version 2).** The undo
  window and the standing approval are now held exactly (`docs/SECURITY.md`).
  Allowances written on the earlier contract do not exist on this one: they show
  stopped, and Home offers to clear what they could still draw. A payment the
  assistant queued is carried out by the app that shows the countdown; if that
  app is closed before the window ends, the run goes stale after fifteen
  minutes and nothing moves.
- **The assistant needs a model key to understand free speech.** Without
  `KIMI_API_KEY` it follows only the plain requests its grammar knows, and says
  so. The model path is written and tested against the answer shapes, and has
  not been run against the live model from this repo: there was no key to run
  it with. `assistant-brain.live.test.ts` runs it the day there is.
- **The phone listens and speaks from its next build.** The packages are
  installed and the recognition plugin is in `app.json` (15 October 2026); the
  build itself has not been made. Until it is, the talk sheet is typed to.
- **Listening on the device in the browser has not been tried on a real
  phone.** It is written and its pieces are tested; the first download and a
  spoken request on a mid-range Android in Firefox, and in the iPhone
  home-screen app, are still to be seen.
- **Records follow the account, through Upstash.** Since 15 October 2026
  saved people, allowances, seats, staff, invoices, tax reserves, activity
  (with the notes people wrote) and the savings figure are sealed on the device
  and kept on the server (`packages/core/record-sync.ts`, `/api/records`); a
  device that has none of them reads them back. The newer copy of a collection
  wins whole, so two devices editing the same list at the same moment keep the
  later one. Without Redis in production the route answers 501 and records stay
  on the device, as before. The compare-and-set runs as a Lua script on Upstash
  and has been tested against the in-memory store only.
- **Signing in on a new device brings the account, its money, its payments
  and its records.** "I already have an account" (added 10 October 2026) asks
  for the passkey the account was made with, so the same account opens on the
  phone app, a phone browser and a desktop. The name is asked for again; saved
  people, allowances and invoices follow from the server (above), and payments
  from the index.
  - It works only where the passkey can be reached: carried over by the same
    Google or Apple account, or by choosing the other device when the browser
    asks. Not tried on real devices yet.
  - The account's domain moved from `entole.vercel.app` to `entole.pro` on
    11 October 2026. A passkey belongs to its domain, so accounts made at the
    earlier address cannot be opened at this one. They held test money only.
    The earlier address now sends people on to the new one.
  - Accounts made before this on separate devices are separate accounts and
    stay that way.
  - Passkeys made before 15 October 2026 are all saved under the same label,
    "Entole account". Since then each is saved under the person's username and
    name (`passkeyLabel` in `packages/core/passkey.ts`); the phone now asks for
    the name before it makes the passkey.
- **Seats and supply requests are not offered.** A team member has no account
  to sign with, so the contract cannot enforce a seat, and supply requests were
  kept only until the page reloaded. Neither is linked from either app; the two
  unlinked web pages were removed on 15 October 2026. The core functions stay.
- **A held invoice holds nothing.** "Held" means the business will not treat
  the request as due until the rate is at or better than the one it set.
  Checking it reads the business's own record and the live rate, and releasing
  it changes the record from held to sent; no money moves. Releasing it
  automatically needs the server store (Upstash) and a registered Chainlink
  workflow, and neither is set up.
- **An invoice paid by card or bank is still marked by hand.** A payment made
  from an invoice link through the app carries the invoice's tag in its salt
  (`packages/core/invoice-tag.ts`), and the business's app marks that invoice
  paid when the index shows it (since 15 October 2026). A payment that came any
  other way carries no tag.
- **Money that arrives is told in the app, not outside it.** A payment shows in
  the receiver's activity and a banner says so while the app or the page is
  open (see "Money that arrives" in `docs/ARCHITECTURE.md`). There is no alert
  when the app is closed: that needs a notifications module in a new phone
  build, push credentials for Android, and a push handler for the browser.
- **Money that arrives outside the apps is listed from the index.** Test money
  and money sent in from another app show in activity as "Test money" and "Money
  in" once the index from 15 October 2026 is running (it reads AUSD transfers,
  leaving out the router's and the policy's own). Until it is deployed they
  raise the balance only.
- **A tax reserve is a figure, until it is moved.** Marking an invoice paid (by
  hand, or by its tag) sets 20% of it aside as a kept record, with no payout date
  made up. It leaves the balance only when the person moves it into savings
  from Business.
- **Bill refunds need the bills account's key.** When the biller refuses after
  the person's payment settled, the payment is sent back from the bills account,
  once (since 15 October 2026). That needs `BILLS_PRIVATE_KEY`; without it the
  refusal is logged with the payment hash and returned by hand, as before. The
  router's fee is not returned: it was never the bills account's.
- **Money in from Tron and Solana is built and not yet tried with real money.**
  Add money offers "From Tron or Solana" on both apps (15 October 2026): the
  person keys in how much they are sending, gets a scan code for that one
  deposit, and sees it arrive (`/api/aurora/deposit`).
  - Nobody is asked for an account over there. A deposit that cannot be
    completed is held for them in their own NEAR Intents account, named by
    their Entole address (`refundType: 'INTENTS'`). 1Click accepted exactly
    that in a free price check on 15 October 2026, and charged no refund fee
    where a refund on Tron costs about $0.90. Aurora's own service has not been
    asked, because there is no `AURORA_INTENTS_API_KEY` yet.
  - What is held is shown at the top of Add money, and "Bring it in" moves it
    home: 1Click writes the intent, the person's own key signs it, and it goes
    as USDC on Arbitrum into a holding address that turns it into the account's
    money (`packages/core/intents-held.ts`, `/api/aurora/held`). That needs
    `ONECLICK_API_KEY`, 1Click's partner key, which does not exist yet.
  - Main network only. Aurora has no test network, so nothing has been sent.
  - On 10 October 2026 Aurora refused Tron deposits under $100 ("temporary swap
    limits"). The screen passes on whatever the service says.
  - Each deposit is for a stated amount, good for an hour. Money sent after the
    deadline, or something other than what was picked, may not arrive.
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
- **Savings earn only on the main network.** There they go straight into
  Aave's AUSD vault and earn what borrowers pay (about 3.3% a year on 10
  October 2026; it moves, and tops out near 3.6% in normal conditions). On the
  test network nothing pays, savings sit in `GrowthVault`, and the screens say
  they do not earn interest yet.
  - Proven against the real vault on a copy of mainnet, not with real money.
  - "Earned so far" needs to know what went in. That is kept on the device, so
    a new device shows the balance and the rate but no earnings figure.
  - If nearly all of the vault is lent out, taking savings out is refused until
    some comes back. The app says so before anything is signed.
  - The money is in Aave's contracts, not ours. That is the point, and the risk.
- **Stocks can be looked at, not bought.** The list and every figure are live
  (`/api/stocks`, `packages/core/stock-market.ts`); the Buy button is disabled.
  - Buying needs the issuer to approve the buyer (identity checks, an allowed
    account) or a broker's credentials on a server. Neither exists yet.
  - Prices come from the exchange's own website endpoints. They are free and
    need no key, and they are not a contracted feed: if they change or refuse
    our server, the screens say stocks cannot be shown. A paid feed replaces
    them before buying opens.
  - The exchange's full table runs a trading day behind its quotes, so each
    page of the list is refreshed from the quote endpoint before it is sent.
  - Shares named after a coin are not listed (decided 10 October 2026), and a
    company's own description is dropped when it talks about coins. The rule
    reads names and descriptions, so companies whose business is coins under an
    ordinary name are still listed, without the description.
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
- The index needs no key of ours: it runs on Envio's hosted service, which
  holds its own. Its free deployment is kept 30 days at most (the current one,
  `edc5168`, made 15 October 2026), so it has to be redeployed or moved to a
  paid tier before then; each deployment has a new address
  (`indexer/README.md`, "Deploying it").
- `AGORA_ACCESS_KEY`, `AURORA_INTENTS_API_KEY`, `NANSEN_API_KEY`,
  `CHAINLINK_CRE_WEBHOOK_SECRET` (see `docs/CRE.md`), `KIMI_API_KEY`.
- `BILL_PAYMENT_API_KEY`, `BILL_ITEM_CODES` and `NEXT_PUBLIC_ENTOLE_BILLS_ADDRESS`
  (the account bills are paid into) for Pay a bill.
- Apple Team ID for the iOS `apple-app-site-association` file.
- `NEXT_PUBLIC_ONRAMP_URL_TEMPLATE`: the fiat on-ramp partner for checkout links
  (`apps/web/lib/onramp.ts`).

Two integrations are best-effort until their first live call, and their
endpoint paths are environment variables so a mismatch is fixed without code:
Nansen (`NANSEN_API_BASE`, `_NETFLOW_PATH`) and Flutterwave
(`BILL_PAYMENT_API_BASE`, `BILL_VALIDATE_PATH`, `BILL_PAY_PATH`). Aurora was a
third until 10 October 2026; its request and answer are now the ones the live
service gives (see `packages/core/aurora-intents.ts`).

## Going to mainnet

- Agora AUSD on Monad mainnet: `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`
  (chain 143, 6 decimals). Redeploy `EntoleRouter` against it and change the
  token and router addresses in config; `EntolePolicy` needs no change.
- Remove the test faucet routes. Replace `/api/gas` with real sponsorship (account abstraction or a paymaster).
- Fee treasury becomes a dedicated multisig, not the deployer.
- An independent audit of `EntolePolicy`, `EntoleRouter` and `GrowthVault` before
  real money. The tests are thorough; they are not an audit.
- Rewrite every sentence that says "test network" or "test money": the Terms
  and the Privacy notice (`packages/core/legal.ts`: "What Entole is today",
  "Savings and stocks", "The service as it is", "What is public"), the first
  page (`apps/web/components/Landing.tsx`).
  `apps/web/tests/legal-network.test.ts` fails the day `NEXT_PUBLIC_CHAIN_ID`
  becomes 143 until they are. Asked for by the owner on 12 October 2026.
- A lawyer reads the Terms and the Privacy notice before that day. They were
  drafted from what the code does, not reviewed.
