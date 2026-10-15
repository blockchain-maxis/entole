/**
 * What each event becomes in the index. Written for HyperIndex 3's
 * `indexer.onEvent`, and run for real by `test/handlers.test.ts`, which feeds
 * these handlers events and reads back what they stored.
 *
 * A handler can only read what `config.yaml` asks for under
 * `field_selection`. A field that is not named there is not fetched, and
 * reading one anyway is a type error: the first version of this file read the
 * payment's hash without asking for it.
 */
import { indexer } from 'envio';

/**
 * Accounts whose movements of the account's money are already written down
 * by another event, or are not payments at all: the router (its three legs of
 * every payment are one `Paid`), both policy deployments (a draw is one
 * `Executed`), and the savings vaults (putting money aside is not paying
 * anyone). Lower-case, as the index keeps every account.
 */
const NOT_A_PAYMENT = new Set([
  '0x26dfd3aa7601b57d8b7bb9e9555f5bdac60dab01', // EntoleRouter
  '0xee9c2ce4fc3a58f88d3e2fce9807cdca3a97ed3e', // EntolePolicy, 9 Oct 2026
  '0x0d57a7713123c52f2bfa513f71ea811f61e67c33', // EntolePolicy version 2, 15 Oct 2026
  '0x9d904c6a9231f16913ad3a41563dcb07bf9d89bd', // GrowthVault, the one the apps use
  '0x49ea1846326b3398783001a26d303f0b82b0d9dc', // GrowthVault, the duplicate
]);

/** An ordinary payment: who paid, who was paid, what arrived, what it cost. */
indexer.onEvent({ contract: 'EntoleRouter', event: 'Paid' }, async ({ event, context }) => {
  context.Payment.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    from: event.params.from,
    to: event.params.recipient,
    amount: event.params.amount,
    fee: event.params.fee,
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
    byAssistant: false,
    door: 'router',
    salt: event.params.salt,
  });
});

indexer.onEvent(
  { contract: 'EntolePolicy', event: 'AllowanceCreated' },
  async ({ event, context }) => {
    context.Allowance.set({
      id: event.params.id,
      owner: event.params.owner,
      delegate: event.params.delegate,
      revoked: false,
      createdAtBlock: BigInt(event.block.number),
      createdAtTimestamp: BigInt(event.block.timestamp),
      createdAtTx: event.transaction.hash,
    });
  },
);

indexer.onEvent({ contract: 'EntolePolicy', event: 'AllowanceRevoked' }, async ({ event, context }) => {
  const existing = await context.Allowance.get(event.params.id);
  if (!existing) return;
  context.Allowance.set({ ...existing, revoked: true });
});

/**
 * A payment the assistant made inside an allowance. The event names the
 * allowance and who was paid, not who paid: that is the allowance's owner,
 * read from the allowance this index already holds. It is kept twice. As an
 * `Execution`, tied to its allowance, for the allowance's own history; and as
 * a `Payment`, so the person's history has it beside their ordinary sends.
 */
indexer.onEvent({ contract: 'EntolePolicy', event: 'Executed' }, async ({ event, context }) => {
  const id = `${event.transaction.hash}-${event.logIndex}`;
  const timestamp = BigInt(event.block.timestamp);

  context.Execution.set({
    id,
    allowance_id: event.params.id,
    recipient: event.params.recipient,
    amountMinor: event.params.amount,
    timestamp,
    txHash: event.transaction.hash,
  });

  const allowance = await context.Allowance.get(event.params.id);
  // An allowance made before this index's first block is not known here, and
  // a payment with nobody to say it came from is not written down as one.
  if (!allowance) return;
  context.Payment.set({
    id,
    from: allowance.owner,
    to: event.params.recipient,
    amount: event.params.amount,
    fee: 0n,
    timestamp,
    txHash: event.transaction.hash,
    byAssistant: true,
    door: 'allowance',
    salt: undefined,
  });
});

/** A run the assistant put in the queue, waiting out its undo window. */
indexer.onEvent({ contract: 'EntolePolicy', event: 'Proposed' }, async ({ event, context }) => {
  context.AssistantRun.set({
    id: event.params.runId,
    allowance_id: event.params.id,
    recipient: event.params.recipient,
    amount: event.params.amount,
    readyAt: event.params.readyAt,
    state: 'waiting',
    proposedAt: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });
});

indexer.onEvent({ contract: 'EntolePolicy', event: 'Cancelled' }, async ({ event, context }) => {
  const run = await context.AssistantRun.get(event.params.runId);
  if (run) context.AssistantRun.set({ ...run, state: 'cancelled' });
});

indexer.onEvent({ contract: 'EntolePolicy', event: 'RunCarriedOut' }, async ({ event, context }) => {
  const run = await context.AssistantRun.get(event.params.runId);
  if (run) context.AssistantRun.set({ ...run, state: 'carried-out' });
});

/**
 * The account's money moving some other way than a payment in the app: test
 * money (from nobody: a mint), or money sent in from another app. Everything
 * the other events already record is left out, and so is a draw the assistant
 * made inside an allowance, which is the log just after its `Executed`.
 */
indexer.onEvent({ contract: 'SettlementToken', event: 'Transfer' }, async ({ event, context }) => {
  const { from, to, value } = event.params;
  if (value === 0n || from === to || NOT_A_PAYMENT.has(from) || NOT_A_PAYMENT.has(to)) return;
  const drawn = await context.Payment.get(`${event.transaction.hash}-${event.logIndex - 1}`);
  if (drawn?.byAssistant) return;
  context.Payment.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    from,
    to,
    amount: value,
    fee: 0n,
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
    byAssistant: false,
    door: 'transfer',
    salt: undefined,
  });
});

indexer.onEvent({ contract: 'EntolePolicy', event: 'Paused' }, async ({ event, context }) => {
  context.PauseChange.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    owner: event.params.owner,
    paused: event.params.paused,
    timestamp: BigInt(event.block.timestamp),
  });
});

indexer.onEvent(
  { contract: 'EntolePolicy', event: 'PasskeyRegistered' },
  async ({ event, context }) => {
    context.PasskeyRegistration.set({
      id: `${event.transaction.hash}-${event.logIndex}`,
      owner: event.params.owner,
      x: event.params.x,
      y: event.params.y,
      timestamp: BigInt(event.block.timestamp),
    });
  },
);
