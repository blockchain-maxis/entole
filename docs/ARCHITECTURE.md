# Entole — Architecture

Chain: Monad. What is deployed and live at entole.pro runs on Monad's test
network, chain ID 10143: the contracts, the money (Agora's test AUSD) and
every payment. Monad mainnet is chain ID 143; the parts written for it
(real AUSD, savings that earn, money in from other networks) are named as
such where they appear, and none has been used with real money.

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

### The assistant you talk to

Since 12 October 2026 the assistant is someone you talk to (or type to) who
works the app for you: it opens a screen, picks the person, fills in the
amount, reads out a balance. It is optional. Off, there is no microphone
anywhere and nothing else about the app changes.

Talking and paying are two settings (since 15 October 2026). Talking needs no
key and asks for nothing: the assistant only reads what was said and works the
app. Paying inside allowances needs the assistant's own key, a second passkey
ceremony, which is asked for once, when the person writes their first
allowance or lets it pay inside the ones they have (`apps/*/lib/assistant.tsx`).

The trust model above is unchanged, and three things keep it so.

- **A fixed vocabulary.** `packages/core/assistant-actions.ts` lists everything
  the assistant can do: open a screen, get a payment ready, show how to be
  paid, open savings or a bill, say a fact, pause or resume itself. Whatever
  reads the sentence can only answer in those actions; anything else is thrown
  away whole (`assistantReplySchema`), on the server and again on the device.
  There is no action for confirming, and none can be invented.
- **The reader never sees the account.** A plain grammar on the device
  (`readPlainRequest`) reads the sentences that can only mean one thing. The
  rest go to a language model through `/api/assistant/turn`
  (`packages/core/assistant-brain.ts`), which is sent the words, the name of the
  screen and the last few turns: no balance, no names, no history. When someone
  asks what their balance is, the model answers "tell them the balance" and the
  app says the figure from its own books (`tellAbout`). A spoken figure is
  always the real one. Names are matched on the device (`findSavedPayee`).
- **It cannot confirm.** What it does with a payment is navigate: Send opens
  with the person and the amount filled in (`apps/web/lib/assistant-talk.tsx`,
  `apps/mobile/lib/assistant-run.ts`). Review and Confirm are pressed by the
  person, and confirming raises the fingerprint or passkey prompt inside the
  gateway (`confirmMovement`), which no code can answer. Those two files hold
  no way to send or sign, and a test in each app keeps it that way. The one
  payment the assistant starts itself is inside an allowance that has enough
  left: that becomes a proposal, waits out its undo window, and is held to its
  limit by the contract, exactly as before.

Listening and speaking are the browser's or the phone's own, or a model on the
device. Entole receives words, never sound.

- **The browser's own listening.** Where it works (Chrome, Edge, Android), it is
  the Web Speech API (`apps/web/lib/voice.ts`).
- **Listening on the device.** Where it is missing or does not deliver (Firefox,
  Brave, the iPhone home-screen app, the browsers inside other apps), a small
  speech model runs in the browser itself (`apps/web/lib/device-listening.ts`,
  `whisper.worker.ts`): Whisper tiny, English, through transformers.js 3.8.1.
  Nothing of it is in the app's bundle. After the person agrees to a one-time
  download of about 65 MB, the library and its runtime come from jsDelivr at
  that pinned version and the model from Hugging Face; the browser keeps them.
  The microphone is recorded, the recording becomes words in a worker, and only
  the words go on. The worker has no access to the page or the account, and
  words only ever get a payment ready for the person to confirm.
- **The phone.** `expo-speech-recognition` and `expo-speech`, loaded so that a
  build without them still runs and is typed to (`apps/mobile/lib/voice.ts`).
  Both are installed and the recognition plugin is in `app.json`; a build made
  after 15 October 2026 listens and speaks.
- **Speaking** is the browser's or the phone's own voice. On an iPhone the
  browser's voice is woken inside the tap that opens the sheet, so the reply,
  which comes after waiting on the network, can still be heard.

## Records that follow the account

Saved people, allowances, seats, staff, invoices, tax reserves, activity and
the savings figure are the person's own records (`packages/core/records.ts`).
They are kept on the device and, since 15 October 2026, carried between the
account's devices (`packages/core/record-sync.ts`, `apps/web/app/api/records`).

- **Sealed on the device.** Each collection is encrypted with AES-256-GCM under
  a key made from the owner key's signature over a fixed sentence, through
  HKDF. secp256k1 signatures here are deterministic (RFC 6979), so every device
  signed in with the same passkey makes the same key; a test fails if that ever
  stops being true. The signature is never sent. The account and the
  collection's name are bound into each seal, so one cannot be passed off as
  another. The server keeps what it cannot read.
- **Signed requests.** Reading and writing carry the owner key's signature, like
  the payments feed. A write's signature covers the sha256 of exactly what is
  stored and when it was written.
- **Newest wins.** Each collection carries when it was written. A write is kept
  only if it is newer than the copy held (a compare-and-set on Upstash), so a
  request sent twice changes nothing. The first read on a device asks the server
  for anything newer and sends what the server lacks; it waits at most four
  seconds, then goes on with the device's own copy.

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

### Money that arrives

A send is written to the sender's own device. For the person receiving it
there was, until 12 October 2026, nothing but a balance that went up. The test
network only answers a log query 100 blocks back, well under a minute, so the
app could not go and look for itself even if the rule above allowed it.

So the two ends meet on the server (`/api/payments`, `lib/server/payments.ts`,
client in `packages/core/payments-feed.ts`):

- When a payment settles, the sender's app reports which one, signed by the
  sender's account, with the note they wrote and the naira figure they typed.
- The server does not take the report's word for anything that happened. It
  reads that payment's own record from the network (`readSettledPayment`): that
  it settled, who paid, who was paid, how much arrived, when. Only the note and
  the naira figure come from the sender, and the naira figure is kept only when
  it agrees with the amount that moved, at a rate close to the server's own
  (`settledNaira`). Otherwise the server works the figure out.
- It keeps the record for the person paid. Their app collects what is new each
  time it reads the account, signed by their account, writes each one into the
  device's own activity (`records.activity.merge`), and says once that it came
  (`Snapshot.arrived`, `ArrivalAnnouncer` on the phone, `ArrivalNotice` in the
  browser).

An entry, once on the device, is the device's and never changes. The sender is
named as the receiver saved them, or else as the directory names them. Never
by address.

This is display, not enforcement: no check depends on it, and a server that
kept nothing would cost a receiver an entry in a list, never money.

### History that follows the account

The server only knows a payment the sender's app reported, and a device only
knows what happened on it. The index (`indexer/`, Envio HyperIndex) reads the
payment network itself: one `Payment` row for every payment through the router
or inside an allowance. With its address set, each load asks it for the
account's payments, both directions (`packages/core/indexed-activity.ts`), and
writes whatever the device does not have into the device's activity
(`takeInIndexed`). So a new phone has the account's history, and a payment
whose sender never reported it still shows.

Device, server and index all call a payment by the same id, so it is listed
once. They are taken in that order: the server's entry carries the note and
the figure that was typed, which the network does not hold; the index fills in
what is still missing, as "Sent" or "Received" at the rate when it is first
seen. It fills in and never replaces: with the index unset or out of reach,
nothing changes.

### A receipt for it

The same kept payment is what a receipt is drawn from. The server keeps each
one under the reference its receipt prints (`paymentReference`, the first
twelve characters of the payment; `getByReference` reads it back), and from
that one record it draws the receipt three ways, all the same slip
(`packages/core/receipt-slip.ts` turns the record into the words on it):

- **A picture**, `GET /api/receipt/<reference>/image`
  (`apps/web/app/api/receipt/[reference]/image/route.tsx`, drawn by
  `components/ReceiptPicture.tsx` with `next/og`). Portrait, 1080 wide, exactly
  as tall as what it says. This is what "Share receipt" sends.
- **A page**, `/receipt/<reference>`, for whoever is sent the link. It needs no
  account (`lib/public-routes.ts`), stays out of search, and names the picture
  as its preview, so the link shows as the slip in a chat.
- **Inside both apps**, straight after a payment is delivered
  (`ReceiptStep` in the browser, `send/receipt` on the phone), from the
  device's own receipt, which also has what only the sender is owed: the fee,
  the total, the rate, how long it took.

**A receipt cannot be made for a payment that did not happen.** The picture
and the page take one thing from a request: the reference in the path.
Amounts, names, the note and the time all come from the kept record, which was
read from the network when it was kept. With no record there is no picture (a
plain 404) and the page says the receipt is not there, repeating nothing it
was given. `apps/web/tests/receipt.test.ts` holds this: the same picture comes
back whatever else a request carries.

**Sharing.** The sender's app tells the server a payment settled without
waiting to hear back, so the record can be missing for a moment. Before a
receipt is shared the app says it again and waits (`reportForReceipt`;
keeping is idempotent). The browser then fetches the picture and hands it to
the share panel as a file, saves it where a browser cannot share files, and
falls back to the link (`lib/share-receipt.ts`). The phone brings the picture
down and shares the file when the build has `expo-sharing` and
`expo-file-system` (loaded inside a `try`, like the camera); a build without
them shares the receipt in words with its link under them, and the words
alone when the server does not have the payment (`receiptWords`).

**Who can open one.** Anyone with the link: it shows both names and usernames,
the amount, the time and the sender's note. The reference is the start of the
payment's own entry on the network, which is public, so the link is not a
secret and is not treated as one: the Privacy notice says so in those words.
Both routes are rate-limited together (`receipt`, 60 a minute from one place).
A receipt that only the two people on it could open would need a key that is
not derivable from the network; that is not built.

**The watermark** is the name, small and many, in leaning rows
(`watermark` in `packages/tokens/design-tokens.js`, read by all three
drawings). The picture lays it from one square stamp built from the outline
of the word (`apps/web/assets/receipt/watermark-word.json`), which is why the
rows lean one down for every two along and words sit two rows apart: only
then do leaning rows meet themselves on a square. The picture's fonts are the
apps' two faces cut down for it, with tabular figures made the default,
because the renderer cannot ask a font for a feature
(`apps/web/assets/receipt/make-fonts.py` makes them, the letter widths the
picture measures lines with, and the word's outline).

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
