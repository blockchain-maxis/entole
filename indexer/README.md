# Entole indexer (Envio HyperIndex)

Per `docs/ARCHITECTURE.md`: "Do not read history directly from RPC in the
app." This is that indexer, for the Envio bounty and for a real activity
feed and allowance history instead of the app polling `eth_getLogs` itself.

## Status

`EntolePolicy` is deployed to Monad testnet at
`0xd0c1099827e49C07f264927d0Dd3416eb29EA9b7`, block 63375345 — see
`contracts/README.md`. `config.yaml` has the real address and start block.

Config, schema and handlers are still written against Envio's documented
HyperIndex API, not yet run through `envio codegen` — that needs an
`ENVIO_API_TOKEN` for the codegen CLI's login flow, which this environment
doesn't have.

`abis/EntolePolicy.json` is the real, compiled ABI (extracted from
`contracts/out/EntolePolicy.sol/EntolePolicy.json` — not hand-written), so
codegen has the right shape to work from once a token exists.

## To finish

```bash
# Get an API token at envio.dev, then:
export ENVIO_API_TOKEN=...
pnpm dlx envio codegen
pnpm dlx envio dev
```

`src/EventHandlers.ts` may need adjusting once codegen produces the actual
`generated` module — it's written against the documented API shape, flagged
as unverified in its own header, same disclosure pattern as everywhere else
mocked-behind-an-interface in this codebase.
