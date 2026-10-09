# Chainlink CRE release

One invoice release is gated by a Chainlink CRE workflow: an invoice created
with a "release when the rate is at or below" condition stays `pending-release`
until the workflow reports a rate that satisfies it.

## What is built

- `apps/web/app/api/chainlink-cre/release` is the callback. It checks the shared
  secret in constant time, parses the body, finds the invoice, **re-evaluates the
  invoice's own stored condition against the reported rate itself**, and only
  then marks it released. A caller who lies about the threshold changes nothing:
  the stored condition is the one that counts.
- The invoice reaches the server when it is created (`inbox.syncInvoice`).
- `packages/core/chainlink-cre.ts` has the shared rule and the request schema.

## What you provide

The workflow itself runs on Chainlink's side and is not in this repo: it reads
the NGN/USD rate and calls the route. Whatever its trigger, the call is:

```
POST https://<domain>/api/chainlink-cre/release
x-cre-webhook-secret: <CHAINLINK_CRE_WEBHOOK_SECRET>
content-type: application/json

{ "invoiceId": "<id>", "observedKoboPerDollar": 152000, "maxKoboPerDollar": 160000 }
```

Both rates are integer kobo per US dollar. Answers:

| Status | Body |
|---|---|
| 200 | `{ok:true, invoiceId, conditionMet:true}` (released) or `conditionMet:false` (still held) |
| 400 | Not JSON, or not a valid request |
| 401 | Wrong secret |
| 404 | No pending-release invoice with that id |
| 501 | Secret not set, or the server store is not configured |

## Testing it without the workflow

```bash
curl -X POST http://localhost:3000/api/chainlink-cre/release \
  -H "x-cre-webhook-secret: $CHAINLINK_CRE_WEBHOOK_SECRET" \
  -H 'content-type: application/json' \
  -d '{"invoiceId":"<id>","observedKoboPerDollar":150000,"maxKoboPerDollar":160000}'
```

Create an invoice with a release condition in the app first, so there is a
`pending-release` invoice for the route to find.
