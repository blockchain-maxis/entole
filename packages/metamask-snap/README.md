# @entole/metamask-snap

The MetaMask bounty claim: "agent wallet plugin, ERC-7715/7710 scoped
permissions." A Snap that lets a MetaMask user grant Entole's assistant a
scoped, revocable spending permission against the deployed `EntolePolicy`
contract, redeem a payment inside it, and revoke it — each step confirmed in
a Snap dialog, never silent.

## Why this maps to ERC-7715/7710

`docs/ARCHITECTURE.md`'s "Allowances" section already specifies the pattern:
"a scoped delegation with on-chain enforcement... ERC-7715 permission
requests redeemed against ERC-7710 delegations." `EntolePolicy.sol` already
implements that shape as a bespoke contract — one owner, one delegate, a
recipient allow-list, a per-run max, a period cap, an expiry, immediate
revocation. This Snap is that same shape, offered to a MetaMask user who
isn't using Entole's own passkey flow (`packages/core/passkey.ts`).

## What's implemented

- `src/policy.ts` — a standalone `EntolePolicy` ABI fragment (`createAllowance`,
  `execute`, `revoke`) and calldata encoders. Deliberately not imported from
  `@entole/core` — a Snap bundle should stay small and self-contained rather
  than pull in Mera/Zod/React, none of which this Snap needs.
- `src/copy.ts` — every string a user reads, audited against CLAUDE.md's
  banned-word list and the no-raw-address rule (recipients are described by
  count, never by address).
- `src/index.ts` — `onRpcRequest` handler exposing three methods:
  `entole_grantAllowance`, `entole_redeemAllowance`, `entole_revokeAllowance`.
  Each shows a `snap_dialog` confirmation, then sends a real transaction to
  `EntolePolicy` (`0xd0c1099827e49C07f264927d0Dd3416eb29EA9b7`, Monad testnet
  `10143`) via the connected account's own `eth_sendTransaction` — a real
  settlement, not a simulation.

## Status — read before publishing or claiming the bounty

**Verified:** the contract-call side. `EntolePolicy`'s ABI and this package's
encoders match `contracts/src/EntolePolicy.sol` exactly (hand-checked against
the source, not copied from a stale reference). `eth_sendTransaction` /
`eth_chainId` / `wallet_switchEthereumChain` / `eth_requestAccounts` are
standard EIP-1193 methods every Snap host provider implements — this part
needs no unverified SDK surface.

**Unverified — needs a real MetaMask Flask test before shipping:**
- This environment's `WebFetch` couldn't pull working code samples off
  MetaMask's delegation-toolkit docs (client-rendered pages, returned only
  prose). The exact `@metamask/delegation-toolkit` helper APIs
  (`erc7715ProviderActions`, its `grantPermissions`/`redeemDelegations` call
  shapes) are confirmed to exist (`@metamask/delegation-toolkit` on npm,
  confirmed via search) but their precise TypeScript signatures were not
  confirmed against live docs or a real install.
- **What this means concretely:** this Snap does not call MetaMask's actual
  `wallet_grantPermissions` JSON-RPC method or the delegation-toolkit's
  redemption helpers — it achieves the same *effect* (scoped grant, gated
  redemption, immediate revocation) by calling `EntolePolicy` directly
  through the standard provider. That is a legitimate, working
  implementation of the pattern, but it is not literally sitting on top of
  the ERC-7715/7710 RPC surface MetaMask ships. Swapping the three
  `sendToPolicy` calls in `src/index.ts` for the delegation-toolkit's own
  `walletClient.grantPermissions(...)` / `redeemDelegations(...)` once those
  shapes are confirmed against a real Flask instance is the one remaining
  step for a fully spec-literal claim.
- Dependencies (`@metamask/snaps-sdk`, `@metamask/snaps-cli`,
  `@metamask/delegation-toolkit`) are declared in `package.json` but **not
  installed** — this environment didn't run `pnpm install` against them.
  `src/globals.d.ts` stands in for the SDK's own ambient `snap`/`ethereum`
  types so `tsc --noEmit` is self-consistent without a live install; delete
  it once the real dependency is installed (its types take over).
- `snap.manifest.json`'s `source.shasum` is a placeholder
  (`REPLACE_AFTER_BUILD`) — `mm-snap build` computes and fills in the real
  one.
- `typecheck`/`lint` are named `typecheck:local`/`lint:local` in
  `package.json` on purpose — the repo root's `pnpm typecheck`/`pnpm lint`
  walk every workspace package, and this one can't pass either without the
  uninstalled SDK. Run `pnpm --filter @entole/metamask-snap lint:local`
  (etc.) directly once dependencies are installed.

## To actually test this

```bash
cd packages/metamask-snap
pnpm install
pnpm build              # mm-snap build — fills in the real shasum
pnpm watch              # local dev server for MetaMask Flask to load from
```

Install [MetaMask Flask](https://metamask.io/flask/) (the developer build —
regular MetaMask won't load an unpublished Snap), connect it to a
`localhost:8080`-style local Snap source per the CLI's own instructions, and
call the three methods from a test dapp via `wallet_invokeSnap`. Confirm on
Monad testnet with a funded throwaway account before touching anything real.

## Publishing (the real remaining step)

A Snap must be published to npm and pass MetaMask's Snaps directory review
to be installable outside Flask developer mode. That review process,
timeline, and any listing requirements are entirely outside what this
environment can do — the user needs to run that submission themselves once
the Flask-tested build above is confirmed working.
