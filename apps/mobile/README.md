# Entole — phone app

The actual submission. See the repo root [`README.md`](../../README.md) and
`docs/` for product, design, architecture, scope and security.

```bash
pnpm install
pnpm start        # from the repo root, or `pnpm start` here directly
```

## Auth

Passkey account creation and sign-in go through `@entole/core/passkey`
(Mera) — see `docs/ARCHITECTURE.md`'s "Accounts and auth". Two things have
to be true on the device before a real passkey ceremony succeeds; neither is
true yet in this environment:

1. **A relying-party domain that's actually reachable.**
   `EXPO_PUBLIC_RP_ID` (default `entole.to`) needs, hosted on that domain:
   - `https://entole.to/.well-known/apple-app-site-association` — a static
     JSON `webcredentials.apps` entry naming the real Apple Team ID and
     `to.entole.app` (see `app.json`'s `ios.associatedDomains`).
   - `https://entole.to/.well-known/assetlinks.json` — a static JSON entry
     naming `to.entole.app` and the SHA256 fingerprint of the real Android
     signing certificate.

   For local development against a domain other than `entole.to`, set
   `EXPO_PUBLIC_RP_ID` to that domain instead — but the same two files still
   need to exist there, on real infrastructure. `localhost` does not satisfy
   WebAuthn's relying-party requirements on a native app the way it does in
   a browser tab.

2. **A real device with platform passkey support**, per
   `docs/ARCHITECTURE.md`'s original week-one spike: a mid-range Android
   with Google Password Manager, not a simulator (simulators generally lack
   a working platform authenticator for WebAuthn PRF). iOS 18+ / Android 9+
   per `react-native-passkey`'s own requirements.

Until both exist, `registerAccount`/`reauthenticate` in `lib/session.ts`
will fail with a `MeraError` (`PASSKEY_OPERATION_FAILED` or
`PRF_UNAVAILABLE`) — that's the correct, honest failure mode, not a bug to
route around. `packages/core/passkey.test.ts` proves the logic above the
WebAuthn ceremony itself is correct, against a stub authenticator; it can't
and doesn't claim to prove the ceremony succeeds on real hardware.
