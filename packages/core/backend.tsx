import { createContext, useContext } from 'react';

import type { AccountSource } from './account-snapshot';
import type { RelayClient } from './relay-client';

/**
 * The parts of the account's backend that screens use directly, next to the
 * store: the person's own beneficiaries, the sponsor server (adding test money),
 * and the code others use to pay them. The payments gateway stays behind the
 * store; this is everything that isn't a payment.
 */
export type Backend = {
  source: AccountSource;
  relay: RelayClient;
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
  relay: { submitPayment: notSignedIn, requestGas: notSignedIn, requestFunds: notSignedIn },
};

const BackendContext = createContext<Backend | null>(null);

export const BackendProvider = BackendContext.Provider;

export function useBackend(): Backend {
  const backend = useContext(BackendContext);
  if (!backend) throw new Error('useBackend must be used inside BackendProvider');
  return backend;
}
