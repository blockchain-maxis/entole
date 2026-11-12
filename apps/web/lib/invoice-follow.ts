'use client';

import { useEffect, useRef, useState } from 'react';

import { useBackend } from '@entole/core/backend';
import { payInSource, payInSourceLabel } from '@entole/core/intents-pockets';
import { invoicesToFollow, settlingPayment, type InvoicePaymentState } from '@entole/core/invoice-pay';
import { useStore } from '@entole/core/store';

const EVERY_MS = 20_000;

/** "USDT on Tron", for whatever the payer picked. */
export function paidFromWords(source: string): string {
  const known = payInSource(source);
  return known ? payInSourceLabel(known) : 'another app';
}

/**
 * Invoices paid from another app. While the Business page is open and in view
 * it asks, on opening and every 20 seconds, what each open invoice has been
 * paid. An invoice is settled only when a payment to it is `done`: never when
 * it was sent, never while it is on its way. Returns, per invoice id, the
 * latest payment still under way, so the page can say where it has got to.
 */
export function useInvoicePayments(): Record<string, InvoicePaymentState> {
  const { near } = useBackend();
  const store = useStore();
  const [moving, setMoving] = useState<Record<string, InvoicePaymentState>>({});
  const settling = useRef(new Set<string>());
  const { settleInvoice } = store;

  const open = invoicesToFollow(store.invoices);
  const key = open.map((invoice) => `${invoice.id}:${invoice.reference}`).join(',');
  const latestOpen = useRef(open);
  useEffect(() => {
    latestOpen.current = open;
  });

  useEffect(() => {
    if (!key) return;
    let live = true;

    async function check() {
      if (document.visibilityState !== 'visible') return;
      const invoices = latestOpen.current;
      const references = invoices.map((invoice) => invoice.reference!).filter(Boolean);
      if (!references.length) return;
      let answer: Awaited<ReturnType<typeof near.invoicePayments>>;
      try {
        answer = await near.invoicePayments(references);
      } catch {
        // Nothing is shown as paid from a check that failed; the next one may work.
        return;
      }
      if (!live) return;
      const under: Record<string, InvoicePaymentState> = {};
      for (const invoice of invoices) {
        const payments = answer[invoice.reference!.toUpperCase()] ?? [];
        const paid = settlingPayment(payments);
        if (paid) {
          if (settling.current.has(invoice.id)) continue;
          settling.current.add(invoice.id);
          void settleInvoice(invoice.id, undefined, {
            source: paidFromWords(paid.source),
            receivedCents: paid.cents,
            reference: paid.reference,
          }).catch(() => settling.current.delete(invoice.id));
          continue;
        }
        const latest = [...payments].sort((a, b) => b.at.localeCompare(a.at))[0];
        if (latest) under[invoice.id] = latest;
      }
      setMoving(under);
    }

    void check();
    const timer = setInterval(() => void check(), EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key, near, settleInvoice]);

  return key ? moving : {};
}
