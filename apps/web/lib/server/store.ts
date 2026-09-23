import type { Contact, Invoice, Proposal } from '@entole/core/schemas';

/**
 * The server-side store the intake routes need and the client store never had.
 *
 * It exists to unblock the two second-halves flagged in docs/SCOPE.md's
 * business layer: the Telegram webhook has somewhere to write the proposal it
 * parses, and the Chainlink CRE webhook has a specific account's invoice to
 * release. It is convenience, never authority — the same posture as every
 * other backend piece in docs/ARCHITECTURE.md. It holds pending proposals, a
 * Telegram-chat-to-account link, the contacts a message is matched against,
 * and invoice records. It enforces nothing. The policy contract stays the only
 * enforcer: a proposal written here still runs the same undo window and the
 * same signed on-chain call before any money moves, so a compromised server
 * can surface a bad proposal but cannot make a payment an allowance does not
 * already permit.
 *
 * Server-only. Nothing here may be imported from a client component or from
 * `packages/core` client code, the same rule as `lib/server/sponsor.ts`.
 *
 * The default adapter is in-memory: correct for a single-process dev server
 * and for tests, and honest about its limits (it does not survive a restart or
 * span serverless instances). A durable adapter plugs in behind an env var at
 * `getServerStore()` once the deploy target's KV is chosen; the interface does
 * not change when it does.
 */
export interface ServerStore {
  /** Register a one-time linking code the user generated in-app. */
  createLinkCode(accountId: string, code: string): Promise<void>;
  /** Redeem a linking code for a Telegram chat. Returns the linked account id,
   * or `null` if the code is unknown or already spent. */
  linkChat(code: string, chatId: number): Promise<string | null>;
  /** The account a linked Telegram chat belongs to, or `null` if unlinked. */
  accountForChat(chatId: number): Promise<string | null>;

  /** The account's own contacts, so a message is matched against real people
   * rather than an empty book. Empty until synced. */
  contactsFor(accountId: string): Promise<Contact[]>;
  setContacts(accountId: string, contacts: Contact[]): Promise<void>;

  /** The allowance a parsed proposal is charged against — the account's active
   * assistant allowance. A proposal cannot be built without one, since with no
   * allowance behind it the contract would refuse the eventual payment. */
  assistantAllowanceFor(accountId: string): Promise<string | null>;
  setAssistantAllowance(accountId: string, allowanceId: string): Promise<void>;

  /** Write the parsed proposal to the account's inbox, ready for its app to
   * pick up and run the existing undo-window UI. One pending proposal per
   * account, mirroring `Snapshot.proposal`. */
  putProposal(accountId: string, proposal: Proposal): Promise<void>;
  getProposal(accountId: string): Promise<Proposal | null>;
  clearProposal(accountId: string): Promise<void>;

  /** Record a conditional invoice so the CRE webhook can find and release it. */
  putInvoice(accountId: string, invoice: Invoice): Promise<void>;
  /** Locate a `'pending-release'` invoice by id across accounts. The webhook
   * carries only an invoice id, so the lookup is not account-scoped. */
  findPendingReleaseInvoice(
    invoiceId: string,
  ): Promise<{ accountId: string; invoice: Invoice } | null>;
  /** Replace a stored invoice in place after it releases. */
  replaceInvoice(accountId: string, invoice: Invoice): Promise<void>;
}

function createInMemoryStore(): ServerStore {
  const linkCodes = new Map<string, string>(); // code -> accountId
  const chats = new Map<number, string>(); // chatId -> accountId
  const contacts = new Map<string, Contact[]>(); // accountId -> contacts
  const assistantAllowances = new Map<string, string>(); // accountId -> allowanceId
  const proposals = new Map<string, Proposal>(); // accountId -> proposal
  const invoices = new Map<string, Map<string, Invoice>>(); // accountId -> id -> invoice

  return {
    async createLinkCode(accountId, code) {
      linkCodes.set(code, accountId);
    },
    async linkChat(code, chatId) {
      const accountId = linkCodes.get(code);
      if (!accountId) return null;
      linkCodes.delete(code);
      chats.set(chatId, accountId);
      return accountId;
    },
    async accountForChat(chatId) {
      return chats.get(chatId) ?? null;
    },

    async contactsFor(accountId) {
      return contacts.get(accountId) ?? [];
    },
    async setContacts(accountId, next) {
      contacts.set(accountId, next);
    },

    async assistantAllowanceFor(accountId) {
      return assistantAllowances.get(accountId) ?? null;
    },
    async setAssistantAllowance(accountId, allowanceId) {
      assistantAllowances.set(accountId, allowanceId);
    },

    async putProposal(accountId, proposal) {
      proposals.set(accountId, proposal);
    },
    async getProposal(accountId) {
      return proposals.get(accountId) ?? null;
    },
    async clearProposal(accountId) {
      proposals.delete(accountId);
    },

    async putInvoice(accountId, invoice) {
      const forAccount = invoices.get(accountId) ?? new Map<string, Invoice>();
      forAccount.set(invoice.id, invoice);
      invoices.set(accountId, forAccount);
    },
    async findPendingReleaseInvoice(invoiceId) {
      for (const [accountId, forAccount] of invoices) {
        const invoice = forAccount.get(invoiceId);
        if (invoice && invoice.status === 'pending-release') return { accountId, invoice };
      }
      return null;
    },
    async replaceInvoice(accountId, invoice) {
      const forAccount = invoices.get(accountId);
      if (forAccount) forAccount.set(invoice.id, invoice);
    },
  };
}

let store: ServerStore | null = null;

/** The process-wide server store. In-memory today; the seam a durable adapter
 * plugs into once a deploy target's KV is chosen. */
export function getServerStore(): ServerStore {
  if (!store) store = createInMemoryStore();
  return store;
}

/** Test-only: drop all state, mirroring `resetRateLimits` in `sponsor.ts`. */
export function resetServerStore(): void {
  store = null;
}
