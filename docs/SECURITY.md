# Entole — Security

One question, answered plainly, per `docs/SCOPE.md`: **how do we know the
assistant cannot drain you?**

## The answer

Because the assistant is never the thing that decides. It is the only layer
in this system allowed to think, and thinking carries no authority here.

```
Assistant (LLM)          →  proposes a payment. Can be wrong, can be
                             compromised, can hallucinate a number. None of
                             that matters, because it cannot make a payment
                             — only ask for one.

App / backend             →  assembles the proposal, runs the undo window,
                             submits the transaction. Convenience, not
                             security. Assume it is compromised too.

EntolePolicy (contract)   →  arithmetic and a signature check. Never calls
                             a model. Never accepts an assertion from the
                             two layers above it. This is the only layer
                             that can say yes.
```

If a check can be bypassed by the app or the backend behaving badly, it is
not a check — it has to live in the contract, or the feature doesn't ship.
That rule shaped every line of `contracts/src/EntolePolicy.sol`.

## What the contract actually enforces

Source: `contracts/src/EntolePolicy.sol`. Open, ~230 lines, 18 passing tests
in `contracts/test/EntolePolicy.t.sol` — every caveat below has a test that
tries to break it and fails to.

- **A per-transaction maximum.** `execute()` reverts `OverPerRunMax` before
  it looks at anything else if the amount is too big for a single run.
- **A spend cap per period**, with the period rolling over on a floor
  boundary rather than accumulating forever (`_rollPeriod`). Spending the
  full cap, then trying to spend one more unit, reverts `OverPeriodCap` —
  even split across many runs under the per-transaction limit
  (`test_execute_revertsOverPeriodCap_evenAcrossMultipleRunsUnderPerRunMax`).
- **A recipient allow-list.** The assistant cannot redirect a payment
  anywhere it wasn't explicitly authorised to send money —
  `RecipientNotAllowed` on anything else.
- **An expiry.** Past it, every `execute()` call reverts `Expired`,
  unconditionally.
- **Revocation, effective immediately.** The very next `execute()` call
  against a revoked allowance reverts, even in the same block if ordered
  after the revocation
  (`test_revoke_blocksFutureExecuteImmediately`). Revocation is owner-only
  (`NotOwner` for anyone else), and there is a second path —
  `revokeWithPasskey` — that authorises the same revocation from a raw P256
  signature over Monad's RIP-7212 precompile, so the kill switch works even
  when the owner's usual session key isn't the one doing the signing. Proven
  with a real transaction on deployed testnet, not just a local test — see
  "not finished" below for why that distinction matters here specifically.
- **A pause that blocks everything a person owns in one call.** `setPaused`
  touches every allowance under that owner at once — proven by
  `test_setPaused_blocksExecuteAcrossAllOwnersAllowances` — and proven *not*
  to leak into anyone else's allowances by
  `test_setPaused_doesNotAffectAnotherOwnersAllowance`.

## What the contract deliberately does not do

- **It never custodies funds.** The owner's balance stays in the owner's own
  account the entire time; the contract only ever draws against a standing
  ERC20 `approve`, and `execute()` calls `transferFrom` — it never holds a
  balance itself. `test_execute_movesFundsFromOwnerNotFromContract` checks
  the contract's own balance is zero before and after every payment.
  Revoking a `createAllowance` grant is not the only way out — revoking the
  ERC20 `approve` itself, entirely outside this contract, also works, and
  costs the owner nothing extra to reason about.
- **The delegate session key never receives money either.**
  `test_delegateNeverCustodiesFunds` checks this directly: the key the
  assistant's backend holds to call `execute()` has authority, not custody.
  Stealing it lets an attacker try to spend inside the caveats above and
  nothing else — not drain the account, not redirect to an arbitrary
  address, not exceed the cap.
- **It never consults anything off-chain.** No oracle call, no model call,
  no "ask the backend if this is okay" — every check in `execute()` is pure
  arithmetic and storage reads against state the owner themselves wrote.

## Grow, and why it sits outside this contract

Grow (savings and, once a broker is configured, stocks) is backed by a
separate contract, `GrowthVault` (`contracts/src/GrowthVault.sol`, 8 passing
tests, live on Monad testnet at
`0x9D904c6a9231F16913ad3A41563dCB07bF9d89bd`). Unlike `EntolePolicy`, a
deposit vault has to hold a balance, so it does custody funds. That is
exactly why it is a different contract rather than a feature bolted onto the
policy: the "never custodies funds" guarantee above stays literally true of
`EntolePolicy`, and the vault's custody risk is isolated to the vault.

The vault has no assistant path. Only the depositor can withdraw their own
balance; there is no delegate, no allowance, and no caveat grant that reaches
it. An allowance can never move money into or out of Grow, and a compromised
assistant or backend cannot touch a Grow balance at all, because nothing in
the allowance model points at the vault. Accrual in the UI is display-only
until a real yield source exists, and the screens say so rather than showing
a projected return.

## The parts of the trust story that are not finished

Said plainly, the same way the NGN off-ramp is disclosed as mocked rather
than pretended solved:

- **Deployed to Monad testnet**, not mainnet, and not yet audited by anyone
  outside this project. `0xd0c1099827e49C07f264927d0Dd3416eb29EA9b7` — see
  `contracts/README.md` for the deployment block and transaction. Testnet
  status means the state above is demonstrable, not that it has survived
  adversarial review.
- **The P256 passkey-revoke path is proven live**, not just written to spec.
  `forge test` and even a Monad-testnet fork can't exercise it — forking
  mirrors on-chain state, not precompile execution, which runs in
  Foundry's own interpreter — so it was proven the only way that's
  possible: a real transaction. A throwaway account registered a P256 key,
  signed the exact revoke digest, and a *different* throwaway account (not
  the owner, not the delegate) submitted it — `revoked` flipped on-chain,
  and the next `execute()` call reverted `AlreadyRevoked`. Transaction
  hashes and the exact command sequence are in `contracts/README.md`,
  "Proving the P256 path."
- **The account layer above this contract — Mera-derived passkey accounts
  or the Privy fallback — is not built yet.** Today's `signIn()` in
  `apps/mobile/lib/session.ts` is a bare device biometric gate with no key
  derivation and no account behind it. This contract's guarantees hold
  regardless of which account path sits above it, because the contract
  never trusts the app layer either way — but the product's other named
  differentiator, gas-abstracted passkey onboarding, is not represented in
  this document because it does not exist yet to describe.
- **The settlement asset is Agora AUSD on Monad testnet**
  (`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, 6 decimals), not yet mainnet
  AUSD (`0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`, chain 143). The policy
  contract is asset-agnostic — each allowance stores its own `token`, and
  `execute()` only knows `IERC20.transferFrom` — so moving to mainnet is an
  address change in config, not a contract change. `MockERC20` ("eUSD") remains
  in `contracts/src/mocks` for tests only.

## If you're auditing this

Start at `contracts/src/EntolePolicy.sol`. Every `external` function is
short enough to read end to end in one sitting. The thing to try to break is
`execute()` — every other function either can't move money (`createAllowance`,
`revoke`, `setPaused`, `registerPasskey`) or is a read (`wouldExceed`). If you
can construct a call sequence where `execute()` moves more than an owner's
own `createAllowance` call authorised, that is the finding that matters; open
an issue with the call sequence, not a description of it.
