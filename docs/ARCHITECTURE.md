# Entole — Architecture

Chain: Monad mainnet, chain ID 143.

## The trust boundary

This is the load-bearing idea. Read it before changing anything in the agent or
policy path.

The assistant is **untrusted**. It can propose a payment. It cannot make one that
falls outside its allowance, because the allowance is enforced by a contract that
does not consult the assistant, the app, or the backend.

Three layers, and only one of them is allowed to think:

1. **Assistant** — LLM. Parses intent, proposes a payment. No authority.
2. **App / backend** — assembles the proposal, runs the undo window, submits.
   Convenience, not security. Assume it can be compromised.
3. **Policy contract** — arithmetic and signature checks only. Never calls a
   model. Never accepts an assertion. Enforces caps, recipients, cadence.

If a check can be bypassed by the app or backend behaving badly, it is not a
check. Move it into the contract or drop the feature.

## Accounts and auth

**Primary path: Mera** (`@category-labs/mera`, `packages/core/passkey.ts`).
A WebAuthn PRF ceremony returns 32 bytes; those bytes are the secp256k1
private key directly — not a BIP-44 seed, no HD derivation tree. (Earlier
drafts of this doc said BIP-44; that was wrong, corrected here.) No seed
phrase, no bundler, no MPC, no custody. The same passkey, the same relying
party, the same salt reproduces the same account, on any platform.

One passkey derives more than one key by varying the PRF salt — the
mechanism behind the "Mera: one passkey, many keys" bounty. `passkey.ts`
uses this for exactly the split the trust boundary above needs: an owner
key (one salt) and a session/delegate key (a different salt), both from the
same passkey, two different WebAuthn ceremonies. The session key holds no
funds and is exactly the `delegate` `createAllowance` names — see
`contracts/src/EntolePolicy.sol`.

Monad implements the RIP-7212 P256 precompile at `0x0100`, which makes on-chain
verification of passkey signatures cheap (6900 gas per Monad's own docs,
confirmed in `contracts/README.md`'s network reference — the "~3,450" figure
in earlier drafts of this doc was the generic RIP-7212 proposal number, not
Monad's measured cost). This is what makes the model practical here and not
elsewhere, and `EntolePolicy.revokeWithPasskey` uses it directly — proven
live on Monad testnet, see `contracts/README.md`.

**Status**: `packages/core/passkey.ts` is written and tested against a stub
`WebAuthnClient` matching Mera's own documented interface, covering account
derivation, sign-in determinism, session-key derivation via a distinct salt,
real viem signature verification, and session termination.
`apps/mobile/lib/session.ts` wires it to `react-native-passkey` for the
phone app, and `apps/web/lib/session.ts` to the browser's own WebAuthn.

**What has run on real devices, and what has not.** No automated test can
perform a passkey ceremony, so this is the project owner's own use of the
app, not a test result:

- **Accounts have been made and used with real passkeys** on an Android
  phone (in the phone app and in its browser) and in a desktop browser, in
  October 2026, while the app was served from `entole.vercel.app`.
- **The relying-party domain is `entole.pro`** from 11 October 2026. The web
  app serves `/.well-known/assetlinks.json` from
  `apps/web/public/.well-known/`, naming `to.entole.app` and the Android
  build's signing-certificate fingerprint. A passkey belongs to the domain it
  was made on, so accounts made on the earlier domain cannot be opened from
  this one.
- **No iOS passkeys in the phone app.** `apple-app-site-association` still
  holds a placeholder where an Apple Team ID goes.
- **Opening an existing account from a second device** is built and has not
  been tried on real devices. See `docs/BACKLOG.md`.
- PRF support depends on the passkey provider, not just the operating
  system. Where it is missing the app says so and makes no account.

**Fallback if PRF is unreliable on the target device: Privy embedded
wallets.** Not implemented — Mera was built first per direct instruction.
If a target device turns out not to support it, `packages/core/passkey.ts`'s three
functions (`createOwnerAccount`, `signInToOwnerAccount`,
`deriveSessionAccount`) are the seam to replace; everything downstream
(the viem `LocalAccount`, `createOnChainGateway`) only depends on getting a
`LocalAccount<"mera">`-shaped object back, not on how it was derived.

## Names people are paid by

A person is paid by their username or their phone number. Nothing else is
shown, typed or shared: there is no code to copy.

- **A username is one person's.** The directory (`apps/web/app/api/directory`,
  storage in `apps/web/lib/server/directory.ts`, client in
  `packages/core/directory.ts`) keeps `username -> account` and gives a username
  to the first account that claims it, in one step, so two claims arriving
  together cannot both win. Every claim is signed by the account, and the
  username is part of what is signed. Changing a username releases the old one.
- **Both apps ask before they claim.** The sign-up and profile screens ask the
  directory as the name is typed (`useUsernameCheck`), and the claim itself is
  what decides. An account made before this claims its username the next time
  the app is opened; if someone else got there first, the person is told and
  chooses another.
- **Paying by name.** `packages/core/recipient.ts` is the one door: typed text,
  a pasted link, a scanned square and a link opened from another app all go
  through `readRecipient`, which reads `@username`, a Nigerian phone number in
  any of its spellings, or a pay link, and `findRecipient`, which asks the
  directory who it is. The name shown is always the directory's, never one a
  link carried. The address it returns is used to pay and is never shown.
- **The pay link is the username.** `https://entole.pro/pay/@name`, with
  whatever it asks for after it (an amount, an invoice reference, a note, a due
  date). Receive, the QR and every invoice are built with `buildPayLink`. A link
  is only made once the directory has said the username is this account's.
  `entole://pay/@name` opens the same link in the phone app, at
  `apps/mobile/app/pay/[code].tsx`, which unlocks first when it has to.
- **A phone number is kept one way.** `canonicalPhone` drops the leading zero
  and the country code, in the app before a claim is signed and again in the
  route before anything is stored or looked up, so "0901 236 5123" and
  "+234 901 236 5123" are one number.
- **There used to be a payment code.** `PAY-XXXX-…` carried the whole account
  and was what people shared before usernames. It was removed from every
  screen and every link on 12 October 2026. `packages/core/payment-code.ts`
  remains as the form records keep an account in (staff, the id of someone
  paid without being saved), and a link in the old form is still read so that
  one somebody already has keeps opening. Nothing makes one any more, and a
  test in each app (`nobody is ever shown, or asked for, a code to be paid`)
  keeps it that way.

## Allowances

An allowance is a scoped delegation with on-chain enforcement. The pattern to
follow is ERC-7715 permission requests redeemed against ERC-7710 delegations,
with caveat enforcers holding the constraints. A session account holds no funds
and can only act inside its caveats.

Every allowance binds, at minimum:

- Spend cap per period, and the period
- Recipient allow-list
- Per-transaction maximum
- Expiry
- Revocation, effective immediately

The UI renders exactly one of these concepts: the remaining balance. Everything
else is machinery.

## Payments

**Settlement asset:** Agora AUSD where the mint and redeem routes work, USDC as
fallback. Agora's API is beta as of July 2026 — access key exchanged for a
short-lived session token, with routes for minting and redeeming against fiat or
other stablecoins. Wrap it behind an interface so swapping to USDC is a one-file
change.

**Sending, gasless and single-signature.** A send is one ERC-3009
`receiveWithAuthorization` signed by the person's passkey-derived key, for
`amount + fee`, paid to `EntoleRouter`. A sponsor server (`/api/relay`) submits
it and pays the network fee; the router pays the recipient and the treasury in
the same transaction. The signature's nonce commits to the recipient, amount and
fee, so the server can submit but never alter it. The fee is 0.5%, minimum $0.10,
maximum $2.50, computed by the contract. Proven against the live AUSD contract
(`contracts/test/EntoleRouterFork.t.sol`, `packages/core/onchain-gateway.live.test.ts`).
Things the person does from their own account (pause, allowances) are covered by
`/api/gas`, a test-network top-up.

**Funding:** Aurora Intents for any-chain deposits. A user funds from BTC, USDT
on Tron, SOL or anything else the solver network covers, and receives the
settlement asset on Monad. This directly attacks the last-mile funding problem in
African corridors and is the cleanest bounty claim on the board.

**Off-ramp to NGN** is the genuinely hard part and is out of scope for the
hackathon. Mock it behind an interface, and be honest about it in the submission.
Do not pretend it is solved.

## Data

Envio HyperIndex for activity feeds and allowance history. Do not read history
directly from RPC in the app.

## Optional integrations, in priority order

Add only if the core is done. Each is a self-contained bounty claim.

1. Chainlink CRE workflow — gate a payment release on an off-chain condition
   (FX threshold, compliance check) before it executes. **Built**: an
   invoice can carry an `fx-rate-at-or-below` `releaseCondition`
   (`packages/core/schemas.ts`), evaluated by the real, tested
   `evaluateReleaseCondition` (`packages/core/chainlink-cre.ts`) — both from
   the in-app "Check condition" action (live today, no account needed) and
   from `apps/web/app/api/chainlink-cre/release/route.ts`, the callback
   target a real CRE workflow POSTs to once registered
   (`CHAINLINK_CRE_WEBHOOK_SECRET`, unset by default). That route can
   validate and re-evaluate but not yet mutate a specific user's live
   invoice — this demo's store has no server-side persistence, the same gap
   the Telegram webhook already discloses. See
   `packages/core/chainlink-cre.ts`'s header for the full design.
2. Nansen — flow intelligence on the corridor.
3. Alchemy Account Kit gas sponsorship, if not already covered by the auth path.

## Failure modes to design around

- **Agent drain.** The reason the policy contract exists. Lead with this in the
  submission: state the security model explicitly, show the caveats, show
  revocation working.
- **Stale session.** Signing sessions expire. Re-prompt biometrically, never
  fail into an unauthenticated state that looks logged in.
- **Beta API breakage.** Agora is new. Every call goes through an adapter with a
  USDC fallback path that is tested, not theoretical.
