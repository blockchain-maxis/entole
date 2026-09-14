# Entole

Cross-border payments and shared spending, built for Nigeria. A mobile money app
where an AI assistant can move money on your behalf, but only inside spending
limits enforced on-chain.

Built for the Monad Metropolis hackathon. Track: Consumer Products & Payments.
Submission deadline: 13 October 2026.

Read `docs/PRODUCT.md` before writing product logic, `docs/DESIGN.md` before
writing UI, `docs/ARCHITECTURE.md` before touching auth, contracts or the agent,
and `docs/SCOPE.md` before agreeing to build anything not already listed there.

## Layout

A pnpm workspace. The phone app is the product; the web app is the same product
rendered for a browser, over the same store and the same gateway.

```
apps/mobile      Expo + expo-router. The phone app.
apps/web         Next.js App Router. The web app.
packages/core    Money, schemas, allowances, gateway, store. No platform.
packages/tokens  design-tokens.js, the Tailwind preset, the `token` export.
docs/            Product, design, architecture, scope.
```

`packages/core` may never import from `react-native`, `expo-*` or `next`. If a
module needs a platform, it belongs in that platform's app. React itself is
fine — the store lives in core and both apps mount it.

Import shared code by package name (`@entole/core/money`, `@entole/tokens`),
never by a relative path across the workspace. `@/` stays app-local.

## Stack

- Expo (React Native) with expo-router, TypeScript strict — `apps/mobile`
- Next.js App Router, React Server Components off where the store is needed — `apps/web`
- NativeWind on the phone, Tailwind on the web, one shared token preset
- Reanimated for motion, FlashList for lists
- expo-local-authentication, expo-secure-store
- Zod for all boundary validation
- Vitest for unit tests
- pnpm workspaces

## Commands

```
pnpm install
pnpm start              # expo dev server
pnpm ios / pnpm android
pnpm dev                # next dev server, web app
pnpm build:web
pnpm test               # every package
pnpm typecheck
pnpm lint
```

Scope a command to one package with `pnpm --filter @entole/core test`.

## Conventions

- File-based routing under `apps/*/app/`. Route names match the design exports
  in `design/`.
- Shared UI primitives in `apps/mobile/components/ui/` and `apps/web/components/`.
  Nothing in a screen file that two screens both need. UI is not shared across
  the two apps — a `View` and a `div` are not the same thing. Logic is.
- Design tokens live in `packages/tokens` and are referenced by name, never by
  hex, anywhere in component code.
- All money is handled as integer minor units. Never floats. Format only at the
  render boundary.
- Every external response is parsed through a Zod schema before it is used.
- Bottom sheets, not modals. Primary actions bottom-anchored.

## Hard rules

These are non-negotiable. They come from the product thesis, and breaking one
loses the track. They bind both apps: each carries its own
`tests/hard-rules.test.ts`, and anything that renders the product is held to
them.

**Never render a blockchain address anywhere in the UI.** People, contacts,
names and photos only.

**Never use the words** wallet, crypto, blockchain, chain, gas, token, on-chain,
signature, or transaction hash **in user-facing copy.** Internal identifiers may
use them. The user reads "payment", "account", "fee", "receipt".

**Never display, generate, export or mention a seed phrase or recovery phrase.**
Authentication is biometric. There is no phrase to lose.

**Never use the system keyboard for a money amount.** Custom numeric keypad,
tabular figures, no layout shift as digits change.

**Never show optimistic state for settlement.** Monad settles in under a second.
Show the real state transition. A payment is pending until it is settled, and
then it is a receipt.

**Assistant-initiated actions are always visually distinct** from user-initiated
ones, in every list, feed and detail view. Use the assistant tint token.

**The pause control is reachable from every screen header.** It is never buried
in settings, never behind a menu, never more than one tap away.

**Every agent capability renders as an allowance with a remaining balance.**
Never as a permission, a scope, a key or a toggle.

## Definition of done for a screen

- Matches the corresponding PNG in `design/` at a glance
- Works one-handed in portrait on a 5.5" screen
- Renders correctly on a mid-range Android, not just an iOS simulator
- No hardcoded hex values
- Naira formatted with ₦, thousands separators, tabular figures
- Loading states are skeletons, not spinners
