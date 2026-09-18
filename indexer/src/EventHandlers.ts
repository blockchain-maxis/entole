/**
 * Written against Envio's documented handler pattern. NOT yet verified by
 * running `envio codegen` against this config — that needs EntolePolicy
 * deployed and an ENVIO_API_TOKEN this environment doesn't have (see
 * config.yaml's header and docs/SECURITY.md's "not finished" section for
 * the same disclosure pattern used everywhere else in this codebase).
 *
 * `context.<Entity>.set(...)` calls below assume the generated context API
 * matches schema.graphql exactly; if codegen surfaces a different shape,
 * this file is what needs editing, not the config or the schema.
 */
import { EntolePolicy } from 'generated';

EntolePolicy.AllowanceCreated.handler(async ({ event, context }) => {
  context.Allowance.set({
    id: event.params.id,
    owner: event.params.owner,
    delegate: event.params.delegate,
    revoked: false,
    createdAtBlock: BigInt(event.block.number),
    createdAtTimestamp: BigInt(event.block.timestamp),
    createdAtTx: event.transaction.hash,
  });
});

EntolePolicy.AllowanceRevoked.handler(async ({ event, context }) => {
  const existing = await context.Allowance.get(event.params.id);
  if (!existing) return;
  context.Allowance.set({ ...existing, revoked: true });
});

EntolePolicy.Executed.handler(async ({ event, context }) => {
  context.Execution.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    allowance_id: event.params.id,
    recipient: event.params.recipient,
    amountMinor: event.params.amount,
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });
});

EntolePolicy.Paused.handler(async ({ event, context }) => {
  context.PauseChange.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    owner: event.params.owner,
    paused: event.params.paused,
    timestamp: BigInt(event.block.timestamp),
  });
});
