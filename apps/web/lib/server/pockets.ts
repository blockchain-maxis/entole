import type { OneClickClient } from '@entole/core/intents-pockets';

import { getRedis, requiresRedis } from './redis';

/**
 * What the pocket and invoice routes share.
 *
 * 1Click answers without a partner key (it adds 25 basis points to each
 * quote); `ONECLICK_API_KEY` lowers that to 1 on a stablecoin pair. Checked
 * live on 12 November 2026. Pockets live on NEAR Intents' main network
 * whatever network the rest of the app is on: there is no test network.
 */
export function oneClickClient(): OneClickClient {
  const apiKey = process.env.ONECLICK_API_KEY?.trim();
  const apiBase = process.env.ONECLICK_API_BASE?.trim();
  return { ...(apiKey ? { apiKey } : {}), ...(apiBase ? { apiBase } : {}) };
}

/** Off only when explicitly switched off. */
export function pocketsEnabled(): boolean {
  return process.env.POCKETS_ENABLED?.trim() !== 'false';
}

// -------------------------------------------------------- invoice payments

/**
 * One payment towards an invoice from another network: which account and
 * invoice a one-time deposit address belongs to. Kept 30 days, which is far
 * past the hour the address is good for, so a late arrival still finds its
 * invoice. No payer details are kept: there are none to keep.
 */
export type InvoicePayment = {
  account: string;
  reference: string;
  depositAddress: string;
  source: string;
  cents: number;
  amountMinor: number;
  at: string;
};

const KEEP_SECONDS = 30 * 24 * 60 * 60;
const memory = new Map<string, string>();
const memoryLists = new Map<string, string[]>();

const paymentKey = (depositAddress: string) => `invoicepay:${depositAddress}`;
const listKey = (account: string, reference: string) => `invoicepays:${account.toLowerCase()}:${reference.toUpperCase()}`;

export class StoreUnavailableError extends Error {}

export async function rememberInvoicePayment(payment: InvoicePayment): Promise<void> {
  const redis = getRedis();
  const value = JSON.stringify(payment);
  if (!redis) {
    if (requiresRedis()) throw new StoreUnavailableError('redis');
    memory.set(paymentKey(payment.depositAddress), value);
    const list = memoryLists.get(listKey(payment.account, payment.reference)) ?? [];
    memoryLists.set(listKey(payment.account, payment.reference), [...list, payment.depositAddress].slice(-20));
    return;
  }
  await redis.set(paymentKey(payment.depositAddress), value, { ex: KEEP_SECONDS });
  await redis.rpush(listKey(payment.account, payment.reference), payment.depositAddress);
  await redis.ltrim(listKey(payment.account, payment.reference), -20, -1);
  await redis.expire(listKey(payment.account, payment.reference), KEEP_SECONDS);
}

export async function invoicePayment(depositAddress: string): Promise<InvoicePayment | null> {
  const redis = getRedis();
  const raw = redis ? await redis.get<string | InvoicePayment>(paymentKey(depositAddress)) : memory.get(paymentKey(depositAddress));
  if (!raw) return null;
  return typeof raw === 'string' ? (JSON.parse(raw) as InvoicePayment) : raw;
}

export async function invoicePaymentsFor(account: string, reference: string): Promise<InvoicePayment[]> {
  const redis = getRedis();
  const addresses = redis ? await redis.lrange<string>(listKey(account, reference), 0, -1) : memoryLists.get(listKey(account, reference)) ?? [];
  const found = await Promise.all(addresses.map((address) => invoicePayment(address)));
  return found.filter((payment): payment is InvoicePayment => payment !== null);
}

/** For tests. */
export function resetInvoicePayments(): void {
  memory.clear();
  memoryLists.clear();
}
