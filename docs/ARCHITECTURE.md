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

**Status**: `packages/core/passkey.ts` is written and tested — 6 tests
against a stub `WebAuthnClient` matching Mera's own documented interface,
covering account derivation, sign-in determinism, session-key derivation via
a distinct salt, real viem signature verification, and session termination.
`apps/mobile/lib/session.ts` wires it to `react-native-passkey` for the
phone app.

**Not yet provable, the same honest way the P256 revoke path was before its
own live proof**: an actual WebAuthn ceremony, on a real device, against
Monad's actual precompile. Two real gaps remain, not skipped so much as
genuinely blocked in this environment:

- **A real relying-party domain.** `entole.to/.well-known/apple-app-site-association`
  (iOS) and `entole.to/.well-known/assetlinks.json` (Android) need to be
  hosted with the real Apple Team ID and Android signing-certificate SHA256
  fingerprint before a passkey ceremony succeeds on a physical device —
  `apps/mobile/app.json`'s `ios.associatedDomains` is set, but the files
  themselves need a domain this environment doesn't control.
- **A real mid-range Android**, per the original week-one spike this
  section used to describe. PRF support on native mobile depends on the
  passkey provider, not just the OS — this claim needs a physical device to
  confirm, same as it always did.

**Fallback if PRF is unreliable on the target device: Privy embedded
wallets.** Not implemented — Mera was built first per direct instruction.
If the device spike above fails, `packages/core/passkey.ts`'s three
functions (`createOwnerAccount`, `signInToOwnerAccount`,
`deriveSessionAccount`) are the seam to replace; everything downstream
(the viem `LocalAccount`, `createOnChainGateway`) only depends on getting a
`LocalAccount<"mera">`-shaped object back, not on how it was derived.

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
