# EntolePolicy

The one thing in Entole allowed to think is arithmetic. Read
`docs/ARCHITECTURE.md` at the repo root before changing anything here — this
contract *is* the trust boundary the whole product is built on.

## What it enforces

An allowance binds, per `docs/ARCHITECTURE.md`:

- Spend cap per period, and the period
- Recipient allow-list
- Per-transaction maximum
- Expiry
- Revocation, effective immediately

`EntolePolicy.execute` reverts the instant any of these is violated. It never
calls a model, never accepts an assertion from the app or the backend, and
never custodies funds — the owner's balance stays in the owner's own account
(an `approve` is all the contract ever draws against), so a compromised
delegate key can move money only where, how much, and how often the owner's
own `createAllowance` call already said it could.

## Status

- Core caveat logic (caps, allow-list, per-tx max, expiry, revocation,
  period rollover, pause) — **written, tested, 18/18 passing**, `forge test`.
- P256 passkey-signed revocation (`revokeWithPasskey`) — **proven live on
  Monad testnet**, 17 Sep 2026, using throwaway verification accounts (not
  the app's auth path, which doesn't exist yet — see "Proving the P256
  path" below for the exact transaction).
- Deployment — **live on Monad testnet**, 17 Sep 2026:
  - `EntolePolicy`: `0xd0c1099827e49C07f264927d0Dd3416eb29EA9b7`, block
    63375345, [tx `0x577bdb…f37c6`](https://testnet.monadscan.com/tx/0x577bdb77dcfb669b9b6614b38c1775a29770cace44db5c6238cd04aacacf37c6)
  - `MockERC20` ("eUSD"): `0xaca20A081Ab69148E291e65dcf4f69Ef9B0674A6`,
    10,000,000 minted to the deployer. **Superseded:** the app now settles in
    Agora AUSD on Monad testnet, `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`
    (Agora's own deployment, not ours; see `docs/SECURITY.md`). eUSD stays for
    tests.
  - `EntoleRouter`: `0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01`, block 64113781,
    [tx `0xcabccaf5…16bf22`](https://testnet.monadscan.com/tx/0xcabccaf5b5c9906c53481fc26e5669b54dcd2cd2fe51325dbe5f043df516bf22)
    — gasless single-signature payments in Agora AUSD. One ERC-3009
    `receiveWithAuthorization` moves `amount + fee` to the router, which pays
    the recipient and the treasury in the same transaction. Fee 0.5%, minimum
    0.10 AUSD, maximum 2.50 AUSD, all immutable; treasury is the deployer. The
    payer's signature commits to the recipient, amount and fee through the
    authorization nonce, so a relayer cannot redirect funds. Proven against the
    real AUSD on a fork: `forge test --fork-url monad_testnet --match-contract EntoleRouterFork`.
  - Deployer: `0xc0d9BC33696d2F5676A1AcB1e39d03046405eE80` — a throwaway
    key generated for this deployment only, funded from the public faucet,
    never used anywhere else. Every deployed contract is source-verified on
    Sourcify; see "Verification" below.
- `GrowthVault` (backs the app's "Grow" feature) — **live on Monad testnet**
  at `0x49ea1846326b3398783001a26d303f0b82b0d9dc` (deployed 23 September 2026 via
  `script/DeployVault.s.sol`), backed by Agora AUSD (`token()` returns
  `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, confirmed on-chain). 8/8 passing,
  `forge test`. An earlier identical vault at
  `0x9D904c6a9231F16913ad3A41563dCB07bF9d89bd` is the one both apps are wired to
  (`apps/mobile/app.json` `extra.entole.growthVaultAddress` and `apps/web/.env`
  `NEXT_PUBLIC_ENTOLE_GROWTH_VAULT_ADDRESS`); the 23 September deploy above is a
  redundant duplicate and can be ignored. Deliberately a separate contract from
  `EntolePolicy`, which never custodies funds by design: a deposit vault has to
  hold a balance, so it sits outside that contract's trust boundary rather than
  compromising it. Only the depositor can withdraw their own balance; there is no
  delegate or allowance path into it. Use `script/DeployVault.s.sol` (against
  AUSD), not `script/Deploy.s.sol`, to redeploy the vault without also
  redeploying `EntolePolicy` and orphaning its live provenance.

## Verification

Every deployed contract is source-verified on Sourcify. Sourcify is keyless, so
this needed no `MONADSCAN_API_KEY`. Each contract returned an exact bytecode
match against the source in this repo. The verification is publicly
retrievable from the Sourcify API at
`https://sourcify.dev/server/v2/contract/10143/<address>` (add `?fields=all` for
the full source), and any explorer that reads Sourcify (Blockscout-family, and
Etherscan's Sourcify lookup) resolves the same source.

| Contract | Address | Match |
|---|---|---|
| `EntolePolicy` | `0xd0c1099827e49C07f264927d0Dd3416eb29EA9b7` | exact |
| `EntoleRouter` | `0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01` | exact |
| `GrowthVault` (wired) | `0x9D904c6a9231F16913ad3A41563dCB07bF9d89bd` | exact |
| `GrowthVault` (duplicate) | `0x49ea1846326b3398783001a26d303f0b82b0d9dc` | exact |
| `MockERC20` ("eUSD") | `0xaca20A081Ab69148E291e65dcf4f69Ef9B0674A6` | exact |

Reproduce for any address above, no key required:

```bash
forge verify-contract 0xd0c1099827e49C07f264927d0Dd3416eb29EA9b7 \
  src/EntolePolicy.sol:EntolePolicy \
  --chain-id 10143 \
  --verifier sourcify \
  --verifier-url https://sourcify.dev/server \
  --watch
```

A `MONADSCAN_API_KEY` still enables the Etherscan-style `--verify` flag during
`forge script` deploys and the `[etherscan]` config in `foundry.toml`; it is no
longer required to make the source public.

## Proving the P256 path

Confirmed directly, not assumed: `forge test`, including on a real
`--fork-url` against Monad testnet (chain ID `10143`, confirmed reachable),
cannot exercise `revokeWithPasskey`. Forking mirrors on-chain *state* —
storage, balances, code — but precompile *execution* runs in Foundry's local
`revm` interpreter, which does not implement Monad's RIP-7212 opcode at
`0x0100`. `test/P256Precompile.t.sol` and the `test_revokeWithPasskey_*` test
in `test/EntolePolicy.t.sol` both probe this at runtime and skip themselves
cleanly rather than faking a pass — they will report `[SKIP]` in this
repo, in CI, and on any fork, permanently, and that is expected and correct.

**Proven instead with a real transaction**, 17 Sep 2026, using throwaway
verification accounts (not the app's own auth path, which isn't built yet —
see docs/SECURITY.md):

1. A throwaway "owner" account created an allowance for a throwaway
   "delegate" session key —
   [`0x6235d1…c7b49`](https://testnet.monadscan.com/tx/0x6235d11dfb0b841e2cdfad30c6125cd892db80bc5a44a7769163a9c358ec7b49).
2. The delegate executed a real payment inside the caveats — 50 eUSD moved
   on-chain —
   [`0x835c7b…59231`](https://testnet.monadscan.com/tx/0x835c7b074a9df670b6abd97af7fedfcce9377c261366d264344846e900592317).
   An over-cap attempt reverted `OverPerRunMax`, checked against the live
   contract via `cast send`'s gas estimation, not just `forge test`.
3. The owner registered a P256 public key (`registerPasskey`), signed via
   `script/sign_p256.py`'s test scalar against the real digest —
   `keccak256(abi.encode(policyAddress, 10143, allowanceId, "revoke"))`,
   computed with `cast abi-encode` + `cast keccak`, not assumed.
4. **Anyone** (the deployer account, deliberately not the owner or the
   delegate, to prove the function checks the signature and nothing about
   `msg.sender`) submitted that signature to `revokeWithPasskey` —
   [`0xdeadf6…5f7a963`](https://testnet.monadscan.com/tx/0xdeadf6020402ee68eb5a51fe51c3c6441779affb5b99c79828f19aa635f7a963).
   `allowances(id).revoked` flipped `false` → `true`.
5. The delegate's next `execute()` call reverted `AlreadyRevoked` — checked
   live, not simulated.

Monad's RIP-7212 precompile verified the signature for real; this is not
achievable any other way in this environment, which is exactly why it
matters as evidence.

## Deploying (or redeploying)

Needs a funded Monad testnet account — get MON from `https://faucet.monad.xyz`.
`contracts/.env` (gitignored, never committed) holds the deployer key used
for the live deployment above.

```bash
export DEPLOYER_PRIVATE_KEY=0x...
export MONADSCAN_API_KEY=...   # optional, for --verify

forge script script/Deploy.s.sol \
  --rpc-url monad_testnet \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast --verify
```

On chain ID `10143` (testnet), the script also deploys `MockERC20`
("eUSD") and mints 10,000,000 to the deployer, so the demo has something to
move before Agora AUSD or a USDC address is wired in. Swapping the
settlement token is a one-address change in `script/Deploy.s.sol`, never a
change to `EntolePolicy` itself.

## Network reference (verified 17 Sep 2026, docs.monad.xyz)

| | Testnet | Mainnet |
|---|---|---|
| Chain ID | `10143` | `143` |
| RPC | `https://testnet-rpc.monad.xyz` | `https://rpc.monad.xyz` |
| Explorer | `https://testnet.monadscan.com` | `https://monadscan.com` |
| Faucet | `https://faucet.monad.xyz` | — |

P256/secp256r1 (RIP-7212) precompile: `0x0100` on both. Input is
`hash‖r‖s‖x‖y`, 32 bytes each, big-endian, 160 bytes total. Output is 32
bytes of `0x…01` on a valid signature, empty on anything else — it never
reverts on a bad signature, which is why `_verifyP256` checks output length
before checking the value. Gas cost per Monad's own docs is 6900 — the
"~3,450" figure in `docs/ARCHITECTURE.md` is the generic RIP-7212 proposal
number, not Monad's measured cost; harmless, not worth chasing down for a
doc edit.

## Testing

```bash
forge test                                                    # 18 pass, 1 self-skip, always
FOUNDRY_PROFILE=ffi forge test --match-test P256               # same skip, with FFI wired for when a real deploy exists
forge coverage
```

`ffi` is deliberately off in the default profile — it shells out to
`script/sign_p256.py` and shouldn't run unannounced in CI. Turn it on only
for the P256 test.
