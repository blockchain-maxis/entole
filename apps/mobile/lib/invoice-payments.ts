import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useBackend } from '@entole/core/backend';
import { payInSource, payInSourceLabel } from '@entole/core/intents-pockets';
import { settlingPayment, type InvoicePaymentState } from '@entole/core/invoice-pay';
import type { Invoice } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

/**
 * Invoices paid from another app, followed while a Business screen is open.
 *
 * The screen asks where each invoice's payments have got to when it comes into
 * view and every twenty seconds while it stays there. An invoice is marked
 * paid only when a payment toward it has arrived (`settlingPayment`), never
 * when it was sent or is on its way, and it is marked once.
 */

const FOLLOW_EVERY_MS = 20_000;

/** "USDT on Tron" from a payment's source id; the id itself if it is one we do not list. */
export function paymentSourceWords(source: string): string {
  const known = payInSource(source);
  return known ? payInSourceLabel(known) : source;
}

export function useInvoicePayments(invoices: readonly Invoice[]) {
  const { near } = useBackend();
  const store = useStore();
  const [payments, setPayments] = useState<Record<string, InvoicePaymentState[]>>({});
  const settling = useRef(new Set<string>());
  const asking = useRef(false);

  // The list changes identity on every render; what is asked about is the references.
  const key = invoices
    .map((invoice) => `${invoice.id}:${invoice.reference ?? ''}:${invoice.status}`)
    .sort()
    .join('|');
  const latest = useRef(invoices);
  useEffect(() => {
    latest.current = invoices;
  });

  const { settleInvoice } = store;

  const ask = useCallback(async () => {
    const followed = latest.current.filter((invoice) => invoice.reference);
    if (asking.current || followed.length === 0) return;
    asking.current = true;
    try {
      const answer = await near.invoicePayments(followed.map((invoice) => invoice.reference!.toUpperCase()));
      setPayments(answer);
      for (const invoice of followed) {
        if (invoice.status !== 'sent' || settling.current.has(invoice.id)) continue;
        const arrived = settlingPayment(answer[invoice.reference!.toUpperCase()] ?? []);
        if (!arrived) continue;
        settling.current.add(invoice.id);
        try {
          await settleInvoice(invoice.id, undefined, {
            source: paymentSourceWords(arrived.source),
            receivedCents: arrived.cents,
            reference: arrived.reference,
          });
        } catch {
          // Asked again on the next round.
          settling.current.delete(invoice.id);
        }
      }
    } catch {
      // A round that fails says nothing new; the next one may work.
    } finally {
      asking.current = false;
    }
    // `key` re-creates the round when the invoices being followed change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, settleInvoice, key]);

  useFocusEffect(
    useCallback(() => {
      void ask();
      const timer = setInterval(() => void ask(), FOLLOW_EVERY_MS);
      return () => clearInterval(timer);
    }, [ask]),
  );

  /** The payments seen toward one invoice, newest first. */
  const paymentsFor = useCallback(
    (invoice: Invoice): InvoicePaymentState[] =>
      invoice.reference ? [...(payments[invoice.reference.toUpperCase()] ?? [])].sort((a, b) => b.at.localeCompare(a.at)) : [],
    [payments],
  );

  return { paymentsFor };
}
