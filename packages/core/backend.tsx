import { createContext, useContext } from 'react';

import type { AccountSource } from './account-snapshot';
import type { AssistantInboxClient } from './assistant-inbox';
import type { DirectoryClient } from './directory';
import type { RelayClient } from './relay-client';

/**
 * The parts of the account's backend that screens use directly, next to the
 * store: the person's own beneficiaries, the sponsor server (adding test money),
 * the opt-in identity directory, the assistant's proposal inbox, and the code
 * others use to pay them. The payments gateway stays behind the store; this is
 * everything that isn't a payment.
 */
export type Backend = {
  source: AccountSource;
  relay: RelayClient;
  directory: DirectoryClient;
  /** The assistant's proposal inbox — where a Telegram-linked chat's parsed
   * proposal lands, and where a chat is linked and the account's contacts are
   * synced from. Convenience, not authority: see `assistant-inbox.ts`. */
  inbox: AssistantInboxClient;
  /** `PAY-XXXX-…` — how this account is named to others. Null until signed in. */
  paymentCode: string | null;
};

const notSignedIn = () => Promise.reject(new Error('Not signed in yet'));

/** What screens see before an account exists: every action refuses, nothing is invented. */
export const pendingBackend: Backend = {
  paymentCode: null,
  source: {
    loadSnapshot: notSignedIn,
    resolveRecipient: () => {
      throw new Error('Not signed in yet');
    },
    resolveContactId: () => undefined,
    listBeneficiaries: async () => [],
    listStaff: async () => [],
    saveStaff: notSignedIn,
    saveManyStaff: notSignedIn,
    removeStaff: notSignedIn,
    saveBeneficiary: notSignedIn,
    removeBeneficiary: notSignedIn,
  },
  relay: {
    submitPayment: notSignedIn,
    submitExecute: notSignedIn,
    validateBill: notSignedIn,
    submitBill: notSignedIn,
    requestGas: notSignedIn,
    requestFunds: notSignedIn,
    startBankTransfer: notSignedIn,
  },
  directory: {
    resolveByAddress: async () => null,
    resolveByPhone: async () => null,
    claim: notSignedIn,
  },
  inbox: {
    read: async () => null,
    clear: async () => undefined,
    registerLinkCode: async () => false,
    sync: async () => false,
    syncInvoice: async () => false,
  },
};

const BackendContext = createContext<Backend | null>(null);

export const BackendProvider = BackendContext.Provider;

export function useBackend(): Backend {
  const backend = useContext(BackendContext);
  if (!backend) throw new Error('useBackend must be used inside BackendProvider');
  return backend;
}
