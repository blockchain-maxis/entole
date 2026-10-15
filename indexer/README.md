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
in between. It does not import the handlers: they are found in
`src/handlers/`, the way the running index finds them, so a handler file in
the wrong place fails here and not after a deploy.

It runs on Envio's hosted service, deployed as below on 13 October 2026. It
read the network from the router's first block to the newest one, and
answers the query the apps send (`fetchIndexedPayments`) for a real account.
A local run needs Docker (`pnpm --filter @entole/indexer dev`, GraphQL at
`http://localhost:8080/v1/graphql`) and has not been done.

## Deploying it

On Envio's hosted service, signed in with the GitHub account that owns the
repository. Once, in a browser: sign in at envio.dev/app and give the Envio
Deployments GitHub app access to this repository. After that it is all the
`envio-cloud` command:

```bash
npx envio-cloud indexer add --name entole --repo entole \
  --branch envio --root-dir indexer --config-file config.yaml --skip-repo-check
npx envio-cloud indexer commits entole                # the commits Envio has seen
npx envio-cloud deployment status entole <commit>
npx envio-cloud deployment logs entole <commit>       # add --build for the build
npx envio-cloud deployment endpoint entole <commit>   # the GraphQL address
```

`--skip-repo-check` because `envio-cloud repos` listed nothing for this
account even with the app installed and working. What tells you the app can
reach the repository is `indexer commits`: a push to the `envio` branch shows
up there within a minute, and a deployment follows it.

The index is built from the `envio` branch, not `main`. `main` moves many
times a day and every move would start the index again from the first block;
`envio` moves only when something in this directory changes:

```bash
git push origin main:envio
```

Only this directory is built there, without the workspace's lockfile, which is
why `envio` is pinned to one exact version in `package.json`: the version that
runs is the version the tests ran against.

Every deployment has its own address. Moving `envio` makes a new deployment
and a new address, and the old one keeps answering only until it is deleted
(the free tier keeps a deployment 30 days at most). So after each move, set
the new address in two places and redeploy the web app; a phone build carries
the address it was built with:

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
