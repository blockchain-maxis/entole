# Entole index (Envio HyperIndex)

`docs/ARCHITECTURE.md`: "Envio HyperIndex for activity feeds and allowance
history. Do not read history directly from RPC in the app." This is that index.

## What it is for

A payment is written to the phone that made it, and a payment that arrives is
collected from the server when the sender's app reported it. Both can miss. A
new phone knows nothing, and a sender's app can close before it reports. The
index misses neither, because it reads the payment network itself.

It keeps one `Payment` row for every payment an Entole account sends or
receives, whichever door it went through:

| Contract | Event | Becomes |
|---|---|---|
| `EntoleRouter` | `Paid` | a `Payment`: who paid, who was paid, what arrived, the fee |
| `EntolePolicy` | `Executed` | an `Execution` on its allowance, and a `Payment` from the allowance's owner, marked as the assistant's |
| `EntolePolicy` | `AllowanceCreated`, `AllowanceRevoked` | an `Allowance` |
| `EntolePolicy` | `Paused` | a `PauseChange` |
| `EntolePolicy` | `PasskeyRegistered` | a `PasskeyRegistration` |

The apps ask it for one account's payments, both directions
(`packages/core/indexed-activity.ts`), and write whatever the device does not
have into the device's own activity (`loadActivity` in
`packages/core/onchain-gateway.ts`). It fills in; it never replaces. With the
address unset, or the index out of reach, activity is what the device and the
server already know.

Two things are not on the network and so are not here: the note someone
wrote, and the naira figure they typed. An entry found only in the index says
"Sent" or "Received", and its amount is worked out at the rate when it is
first seen.

## What is checked, and what is not

```bash
pnpm --filter @entole/indexer codegen        # types from config.yaml and schema.graphql
pnpm --filter @entole/indexer check          # the handlers against those types
pnpm --filter @entole/indexer test:handlers  # the handlers, run, and what they stored read back
```

All three run in CI and pass here. `test/handlers.test.ts` hands the real
handlers events made in the test and reads back the rows, with nothing mocked
in between.

Not done from this repo: a run against the live network. That needs Docker
(`pnpm --filter @entole/indexer dev`, GraphQL at
`http://localhost:8080/v1/graphql`) or Envio's hosted service, and neither was
available where this was written. The first real run is the hosted deployment
below.

## Deploying it

On Envio's hosted service (envio.dev), signed in with the GitHub account that
owns the repository:

1. Add an indexer and choose this repository.
2. Indexer directory `indexer`, config file `config.yaml`, branch `main`.
3. Deploy. It gives a GraphQL address ending in `/v1/graphql`.

Then set that address in two places and redeploy the web app:

- `NEXT_PUBLIC_INDEXER_URL` in `apps/web/.env` (it is public, like every other
  value in that file)
- `extra.entole.indexerUrl` in `apps/mobile/app.json`

To see it working: open the web app in a browser that has never signed in to
the account, choose "I already have an account", and the account's earlier
payments are in Activity.

## After a redeploy of a contract

Put the new address and its deployment block in `config.yaml`, run `codegen`,
and push. The start block matters: the public RPC answers a log query only 100
blocks back, so history comes from HyperSync, from the block named there.
