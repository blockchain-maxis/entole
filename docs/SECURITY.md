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

Source: `contracts/src/EntolePolicy.sol`. Open, ~300 lines, 28 passing tests
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

## Who pays the network fee, and why it changes nothing

The assistant's key holds no funds and, by default, no network-fee balance
either. It signs an EIP-712 `Execute` (allowance id, recipient, amount, a
per-delegate nonce, a deadline) and a sponsor submits it with `executeFor`. The
contract recovers the signer, requires it to be the allowance's delegate, then
runs the same checks `execute` runs. So the sponsor carries gas, not authority:
it cannot change the recipient or amount (the signature covers them, and
`test_executeFor_sponsorCannotSwapRecipientOrAmount` proves a swap reverts),
cannot replay a run (the nonce, `test_executeFor_revertsOnReplay`), cannot use it
late (the deadline), and cannot beat a revoke, a pause or a cap
(`test_executeFor_stillEnforcesEveryCaveat`). Signatures must be low-s, so one
authorisation has one valid encoding.

An allowance id belongs to whoever first creates it. Only that owner may replace
it, and a replace clears the old recipient list (`IdTaken`,
`test_createAllowance_revertsWhenAnotherOwnerClaimsTheId`), so nobody can
pre-claim a predictable id or inherit a stale allow-list.

## Known limits of the deployed contracts

Found reading the deployed source again on 13 October 2026. None lets anyone
take or redirect money, and none lets the assistant spend more than an
allowance says. They are written down rather than fixed because fixing them
means new contracts at new addresses, and what is deployed is what is
described here.

- **A passkey revoke can be played again on the same id.** `revokeWithPasskey`
  signs over the contract, the network and the allowance id, with no counter.
  An owner who revokes that way and later creates an allowance again under the
  same id can have it revoked by anyone holding the old signature, which is
  public once used. It can only ever switch an allowance off. The apps
  revoke with the owner's own transaction and have never used this path (it
  was proven by hand, see below), so no such signature exists for an allowance
  made in the app. It needs a counter in the digest before the apps do use it.
- **The fee has a floor, so small payments pay a larger share.** The router
  charges 0.5%, never less than 0.10 AUSD and never more than 2.50 AUSD, all
  fixed at deployment. On 1 AUSD that floor is 10%; below that it would be
  more, and the relay refuses a payment under 1 AUSD. The fee is read from the
  contract and shown, with the total, before the person confirms; the payer's
  signature covers it, so nobody can charge a different one.
- **`pay` does not refuse the router or the token as the recipient.** A
  payment signed to either would leave the money in a contract with no way
  out. Only the payer's own signature can name a recipient, and the apps only
  ever name a person's account, so this is a way to lose one's own money by
  hand-signing, not a way to lose someone else's.
- **`createAllowance` accepts an allowance that can do nothing.** A zero
  delegate, a zero asset, a cap below the per-payment limit or an expiry
  already past are all accepted. Each makes an allowance that can spend less
  than it reads (or nothing), never more: every payment is still checked
  against every caveat. The apps do not produce these.
- **The assistant's signed payments go in the order they were signed.**
  `executeFor` uses one counter per assistant key across all of that key's
  allowances, so a signed payment that is never submitted holds up the ones
  signed after it until the app signs again with the current count. A signed
  payment is tied to the allowance id, not to a version of it: if the owner
  replaces the allowance before it is submitted, it is checked against the new
  caveats, which is the stricter of the two readings.

## What the app server can and cannot do

The server is convenience, never authority, and it is assumed compromised in the
threat model above. Concretely:

- **Inbox, Telegram, directory:** hold proposals, contacts and chat links. A
  proposal is not a payment: it still runs the undo window and the signed,
  caveat-checked call. The webhook only believes Telegram when it carries the
  registered `secret_token`, link codes are single-use and expire in 15 minutes,
  and in production the store refuses to run without Redis rather than quietly
  losing state.
- **Receipts:** a receipt, as a page or a picture, is drawn only from a payment
  the server kept after reading it back from the network. Nothing in a request
  but the reference is used, so a receipt cannot be forged by writing a link.
  The reference comes from the payment's public entry, so a receipt is
  readable by anyone who looks for it, names and note included: it is treated
  as public, not as a secret link. A compromised server could draw a false
  receipt; it could not move money by doing so.
- **Sponsor routes:** can pay a fee. They cannot move anyone's money without a
  signature the person's device or the assistant's allowance-bound key made.
  What they will pay for is bounded by counting, shared across instances
  through Redis: per caller a minute; per payer (or per allowance) a minute
  and a day, so changing address does not lift it; and for everyone together a
  day (`SPONSOR_DAILY_SENDS`). The per-payer and per-day counts only count a
  payment that would settle. The counts bound the sponsor's cost; they are not
  what protects anyone's money. The sponsor's sends go out one at a time
  within a server instance and not across instances, so two instances can
  pick the same number at the same moment; one of the two sends then fails
  and the person is told their payment did not go through.
- **Fee top-ups and test money** (`/api/gas`, `/api/faucet`) ask for no proof
  of who is calling. Both exist on the test network only and answer 404 on any
  other; on a network where the fee money is worth something, the top-up has
  to become account abstraction, not an open tap. On the test network a top-up
  is still bounded (a few a day for one account, a fixed number a day for
  everyone), because an empty sponsor stops every payment.
- **The directory** answers anyone who holds a username or a phone number;
  that is its job. Lookups are counted per caller, and far fewer are allowed
  by phone number, so it cannot be walked to learn whose number is whose. A
  caller with many addresses can still ask slowly: a number someone published
  is findable by design, and nobody has to publish one.
- **The assistant's reader** (`/api/assistant/turn`) costs money per question.
  A signature is required, but a signature only proves someone holds a key and
  keys are free, so it is bounded by counting too: per caller, per account,
  and for everyone together a day (`ASSISTANT_DAILY_TURNS`). Past a limit the
  app falls back to its plain grammar. The reader never sees an account and
  cannot move money whatever it is asked.
- **Records** (`/api/records`) are kept sealed: each collection is encrypted on
  the device under a key made from the owner key's signature, which never
  leaves it, so the server holds saved people, bank details on file, invoices
  and notes it cannot read. Reading and writing need the owner's signature; a
  write's signature covers the exact copy stored. A compromised server could
  withhold or roll back a collection to a copy the owner once wrote; it could
  not read one, forge one, or move money with one.
- **On-device listening** (`apps/web/lib/whisper.worker.ts`) loads a speech
  library and its runtime from jsDelivr at one pinned version, and the model
  from Hugging Face, after the person agrees to the download. It runs in a
  worker with no access to the page, the account or its keys; what it hands
  back is words, and words can only get a payment ready for the person to
  confirm. The recording never leaves the device.
- **Every page** is sent with headers that keep it out of another site's
  frame, on https, and typed as what it is. The content policy covers who may
  frame the app, where a form may post and plugins; it does not yet list which
  scripts and addresses a page may load, so a script injected into a page
  would not be stopped by the browser. Nothing in the app writes someone
  else's text into a page as markup, and that is what is relied on.
- **Pay a bill:** the biller's key never leaves the server. A bill is paid only
  after the person's own signed payment to the bills account has settled and
  covers the bill at the live rate (a 99-105% band); the payment's one-time
  nonce means a replay pays nothing. The residual risk is a biller refusing after
  the payment settled: it is logged with the payment hash and returned by hand
  (no automatic refund yet).
- **Standing approval:** creating an allowance has the owner approve the policy
  for the allowance's cap across its life, added to whatever is already
  approved. It is headroom, bounded on every draw by the caveats, and revoking
  the approval itself (outside this contract) still works.

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

### Savings that earn

On the main network savings are not held by `GrowthVault`. They go from the
person's own account into Aave's AUSD vault (an ERC-4626 wrapper Aave itself
publishes), and the shares stay in that account. Entole holds nothing and has no
key to them: putting money in and taking it out are the owner's own
transactions, the same trust level as a direct send. The assistant has no path
to them at all, because no allowance names the vault and `EntolePolicy` only
ever pays the recipients an allowance lists.

What this does change is where the risk sits. Money in savings is lent out, so
it depends on Aave's contracts and on borrowers repaying, and it can be
temporarily impossible to withdraw if nearly all of the pool is lent out. The
app refuses a withdrawal the vault cannot honour before anything is signed, and
shows a rate or earnings only when they were read from the vault itself.

## The parts of the trust story that are not finished

Said plainly, the same way the NGN off-ramp is disclosed as mocked rather
than pretended solved:

- **Deployed to Monad testnet**, not mainnet, and not yet audited by anyone
  outside this project. `0xEE9C2cE4FC3a58f88D3E2FCE9807cDcA3A97Ed3e` — see
  `contracts/README.md` for the deployment block and transaction. Its source
  is verified on Sourcify with an exact bytecode match, so anyone can read the
  enforcing contract against what is actually deployed (see `contracts/README.md`,
  "Verification"). Testnet status means the state above is demonstrable, not that
  it has survived adversarial review.
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
- **The account layer above this contract is passkey accounts (Mera), and
  it is proven by use, not by a test.** A passkey ceremony's output is the
  account's key (`packages/core/passkey.ts`); both apps make and open
  accounts with it, and nothing about the key is kept on a server. The logic
  above the ceremony is tested against a stub authenticator; the ceremony
  itself has been done by hand on an Android phone and in desktop browsers.
  The phone app has no passkeys on iOS: the file that vouches for it still
  has no Apple Team ID in it. This contract's guarantees hold whichever
  account path sits above it, because the contract never trusts the app layer
  either way.
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
