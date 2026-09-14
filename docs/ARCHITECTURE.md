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

**Primary path: Mera.** Derives standard BIP-44 EVM accounts client-side from a
passkey via the WebAuthn PRF extension. No seed phrase, no bundler, no MPC, no
custody. The same passkey reproduces the same account across web, iOS and
Android. Signing sessions avoid a biometric prompt on every action.

Monad implements the RIP-7212 P256 precompile at `0x0100`, which makes on-chain
verification of passkey signatures cheap (roughly 3,450 gas against ~300k in pure
Solidity). This is what makes the model practical here and not elsewhere.

**Week-one spike, before anything else is built.** PRF support on native mobile
depends on the passkey provider, not just the OS. Test on a real mid-range
Android with Google Password Manager, not a simulator.

**Fallback if PRF is unreliable: Privy embedded wallets.** React Native and Expo
support is first-class, server signers and delegated actions cover the agent
path, and ZeroDev gives account abstraction with gas sponsorship. Decide by end
of week one and do not revisit.

Note: Privy's WebCrypto path requires a secure context. It fails silently over
plain HTTP.

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
   (FX threshold, compliance check) before it executes.
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
