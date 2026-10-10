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

## The policy contract

`EntolePolicy` with `executeFor` (the assistant's gasless run) and the
`createAllowance` hardening is deployed on Monad testnet at
`0xEE9C2cE4FC3a58f88D3E2FCE9807cDcA3A97Ed3e` (9 Oct 2026, block 69645503), and both
apps and the indexer config point at it. Allowances made on the earlier
deployment do not exist on this one.

If the contract source changes again, redeploy it the same way:

```bash
cd contracts
export DEPLOYER_PRIVATE_KEY=...        # funded on Monad testnet
forge script script/DeployPolicy.s.sol --rpc-url monad_testnet --broadcast
```

Then set the printed address in `NEXT_PUBLIC_ENTOLE_POLICY_ADDRESS`
(`apps/web/.env`) and `extra.entole.contractAddress` (`apps/mobile/app.json`),
and the address and block in `indexer/config.yaml`.

## Server (web)

| Name | Needed for | Notes and how to check |
|---|---|---|
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Assistant inbox, Telegram links, invoices for the CRE route, shared rate limits | **Required in production**: the store refuses to start without it and the routes answer 501. Check: create an allowance, then `POST /api/assistant/proposal` returns `{ok:true}` from the app. |
| `SPONSOR_PRIVATE_KEY` | Relayed sends, assistant runs (`/api/relay/execute`), gas top-ups (`/api/gas`) | A funded key (0.02+ MON). Check: send money in the app; it settles with no fee balance. |
| `RELAY_MAX_AMOUNT` | Optional ceiling on a relayed payment | Minor units (6 decimals). |
| `NEXT_PUBLIC_ENTOLE_POLICY_ADDRESS`, `_ROUTER_ADDRESS`, `_TOKEN_ADDRESS`, `_GROWTH_VAULT_ADDRESS` | Everything on-chain | Public. |
| `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RP_ID` | Network and passkey domain | Public. `NEXT_PUBLIC_RP_ID` is set in the tracked `apps/web/.env` to the host the app is served from; it must match the phone's `EXPO_PUBLIC_RP_ID`, or the same person gets two different accounts. |
| `NEXT_PUBLIC_INDEXER_URL` | Activity history from Envio | Empty keeps activity on the device. |
| `NEXT_PUBLIC_ONRAMP_URL_TEMPLATE` | Fiat on-ramp on checkout pages | Placeholders `{address}` `{amount}` `{currency}` `{reference}`. https only. |
| `NEXT_PUBLIC_ENTOLE_SAVINGS_VAULT_ADDRESS`, `NEXT_PUBLIC_ENTOLE_SAVINGS_RATE_PROVIDER` | Savings that earn | Main network only. The vault is Aave's wrapped AUSD deposit (`0x9e1AcC5BFbf34e2E579763cE14042d957719fE76`); the rate provider is Aave's data provider (`0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad`). Set, savings go into that vault from the person's own account and the screens show the rate read from it. Unset, savings use the plain vault, earn nothing, and say so. On the phone: `extra.entole.savingsVaultAddress` and `savingsRateProvider`. Check: Grow, Savings shows "Earning about …% a year"; add a little, take it out again. |
| `RELAY_API_KEY` | Add money from another app (`/api/onramp/deposit`) and by card (`/api/onramp/card`) | Both are on whenever `NEXT_PUBLIC_CHAIN_ID` is 143 and need no setting; on the test network they answer 501 and the app offers test money. The key is optional (higher rate limit). Check: Add money, From another app, pick what you are sending; a scan code appears. |
| `ONRAMP_MONEY_APP_ID`, `ONRAMP_REFUND_ADDRESS`, `NEXT_PUBLIC_BANK_TRANSFER`, `ONRAMP_RETURN_ORIGIN` | Bank transfer in naira (`/api/onramp/start`) | Off, and shown as "coming soon", until our own Onramp.money app id exists: their public id ignores the address passed in. `ONRAMP_REFUND_ADDRESS` is an account of ours that a failed conversion returns to. `NEXT_PUBLIC_BANK_TRANSFER=on` shows the option (on the phone: `extra.entole.bankTransfer` in `app.json`). `ONRAMP_RETURN_ORIGIN` is optional. |
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

1. `pnpm typecheck && pnpm lint && pnpm test`.
2. Set `SPONSOR_PRIVATE_KEY` and `UPSTASH_*`. Sign in on a phone, add test money,
   send to a contact (one signature, no fee balance needed).
3. Turn the assistant on, create an allowance (an approval and an allowance, two
   transactions behind one screen), then link Telegram and send
   `Pay 5000 to <contact>`. The app announces it, counts down, and settles.
   A refusal (over the cap, paused, revoked) should read in plain words.
4. Then each integration, one key at a time, with the check beside it above.
