# Environment

Every setting the apps read, where it goes, and how to check it works. Nothing
here is needed to run the tests: every integration is finished in code and stays
off (a 501 from the server, or "not available yet" on screen) until its key
exists.

Where things go:

- **Web / server:** `apps/web/.env.local` (gitignored) locally, or the host's
  environment variables. `apps/web/.env.example` lists every name. `apps/web/.env`
  is tracked, so it must hold only the public `NEXT_PUBLIC_*` deployment
  addresses, never a secret.
- **Phone:** `apps/mobile/app.json`, `extra.entole`. Public values only. The
  phone bundle can hold no secret, so every secret is a server variable and the
  phone reaches it through `extra.entole.apiBase`.
- **Contracts:** shell environment for `forge` (`DEPLOYER_PRIVATE_KEY`).

## Before anything else: redeploy the policy contract

The policy contract gained `executeFor` (the assistant's gasless run) and a
`createAllowance` hardening, so it has to be redeployed once. Its tests pass
(`cd contracts && forge test`), but nothing on-chain has changed until you do:

```bash
cd contracts
export DEPLOYER_PRIVATE_KEY=...        # funded on Monad testnet
forge script script/DeployPolicy.s.sol --rpc-url monad_testnet \
  --private-key $DEPLOYER_PRIVATE_KEY --broadcast
```

Then set the printed address in `NEXT_PUBLIC_ENTOLE_POLICY_ADDRESS`
(`apps/web/.env`) and `extra.entole.contractAddress` (`apps/mobile/app.json`),
and the address and block in `indexer/config.yaml`. Allowances made on the old
contract are gone from the new one; create them again.

## Server (web)

| Name | Needed for | Notes and how to check |
|---|---|---|
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Assistant inbox, Telegram links, invoices for the CRE route, shared rate limits | **Required in production**: the store refuses to start without it and the routes answer 501. Check: create an allowance, then `POST /api/assistant/proposal` returns `{ok:true}` from the app. |
| `SPONSOR_PRIVATE_KEY` | Relayed sends, assistant runs (`/api/relay/execute`), gas top-ups (`/api/gas`) | A funded key (0.02+ MON). Check: send money in the app; it settles with no fee balance. |
| `RELAY_MAX_AMOUNT` | Optional ceiling on a relayed payment | Minor units (6 decimals). |
| `NEXT_PUBLIC_ENTOLE_POLICY_ADDRESS`, `_ROUTER_ADDRESS`, `_TOKEN_ADDRESS`, `_GROWTH_VAULT_ADDRESS` | Everything on-chain | Public. |
| `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RP_ID` | Network and passkey domain | Public. |
| `NEXT_PUBLIC_INDEXER_URL` | Activity history from Envio | Empty keeps activity on the device. |
| `NEXT_PUBLIC_ONRAMP_URL_TEMPLATE` | Fiat on-ramp on checkout pages | Placeholders `{address}` `{amount}` `{currency}` `{reference}`. https only. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | Telegram intake | Both required or the webhook answers 501. Register with `pnpm --filter @entole/web telegram:webhook https://<domain>`. Check: in the app go to Me, Connections, get a code, send `/link CODE` to the bot; it replies "Linked." |
| `QWEN_API_KEY` | Parsing messages the plain grammar cannot | Optional. |
| `AGORA_ACCESS_KEY` | `/api/agora/mint`, `/api/agora/redeem` | Check: `curl -X POST .../api/agora/mint -d '{"fromCurrency":"USD","address":"0x..."}'` returns bank details, never an on-chain address. |
| `AURORA_INTENTS_API_KEY` | `/api/aurora/deposit` | Endpoint is best-effort. If the first call fails, set `AURORA_INTENTS_API_BASE` and `AURORA_INTENTS_DEPOSIT_PATH` from Aurora's quickstart. The answer is a `qrPayload`, never text for a screen. |
| `NANSEN_API_KEY` | `/api/nansen` | Endpoint is best-effort: `NANSEN_API_BASE`, `NANSEN_NETFLOW_PATH`. Check: `curl .../api/nansen` returns one headline. |
| `CHAINLINK_CRE_WEBHOOK_SECRET` | `/api/chainlink-cre/release` | See `docs/CRE.md`. |
| `BILL_PAYMENT_API_KEY`, `BILL_ITEM_CODES`, `NEXT_PUBLIC_ENTOLE_BILLS_ADDRESS` | Pay a bill | All three, plus `SPONSOR_PRIVATE_KEY`. Item codes are JSON, e.g. `{"electricity":"<code>"}`; a category without one is unavailable. Endpoint paths are `BILL_PAYMENT_API_BASE`, `BILL_VALIDATE_PATH`, `BILL_PAY_PATH` if Flutterwave's differ. Check: Pay a bill, enter a meter number; it must show the holder's name before asking for an amount. |
| `ENVIO_API_TOKEN` | Running the indexer | `pnpm --filter @entole/indexer codegen`, then `dev`. |

## Phone (`apps/mobile/app.json`, `extra.entole`)

`contractAddress`, `routerAddress`, `tokenAddress`, `growthVaultAddress`,
`rpcUrl`, `chainId`, `indexerUrl` mirror the web values. `apiBase` is the origin
of the deployed web app (it hosts every route above). `billsAddress` is the same
account as `NEXT_PUBLIC_ENTOLE_BILLS_ADDRESS`; empty keeps Pay a bill off.

## Contracts

`DEPLOYER_PRIVATE_KEY` for the deploy scripts. `forge test` needs nothing; the
fork test needs `--fork-url monad_testnet`.

## A test pass, in order

1. Redeploy the policy, set the addresses, `pnpm typecheck && pnpm lint && pnpm test`.
2. Set `SPONSOR_PRIVATE_KEY` and `UPSTASH_*`. Sign in on a phone, add test money,
   send to a contact (one signature, no fee balance needed).
3. Turn the assistant on, create an allowance (an approval and an allowance, two
   transactions behind one screen), then link Telegram and send
   `Pay 5000 to <contact>`. The app announces it, counts down, and settles.
   A refusal (over the cap, paused, revoked) should read in plain words.
4. Then each integration, one key at a time, with the check beside it above.
