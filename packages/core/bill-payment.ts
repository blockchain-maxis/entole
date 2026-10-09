import { z } from 'zod';

/**
 * "Pay a Bill" — electricity, airtime/data, cable TV, internet. Confirmed
 * real (via developer.flutterwave.com/docs/bill-payment, not guessed):
 * Flutterwave's Bills API has a category-listing endpoint, a validate-
 * customer endpoint (`customer_id` + `item_code` in, the billed customer's
 * `name` back so a screen can show "you're about to pay for Chidi Okafor's
 * meter" before money moves), and a create-payment endpoint (`country`,
 * `customer_id`, `amount`, optional `reference` in). Responses come in
 * Flutterwave's `{ status, message, data }` envelope, and `amount` is in
 * naira (major units), not kobo: this module converts at the boundary so the
 * rest of the codebase keeps integer minor units.
 *
 * **Unconfirmed against a live account**: the two endpoint paths and the auth
 * header casing (`Authorization: Bearer FLWSECK_...`, Flutterwave's usual
 * form). They are constants (`BILL_VALIDATE_PATH`, `BILL_PAY_PATH`) and
 * overridable from config, and every response is Zod-validated, so a mismatch
 * fails loudly instead of paying the wrong thing. The `apiKey` is a real
 * secret: this module is called only from `apps/web/app/api/bills/*`, never
 * from a client.
 */

export const BILL_DEFAULT_API_BASE = 'https://api.flutterwave.com/v3';
export const BILL_VALIDATE_PATH = '/bill-items/validate';
export const BILL_PAY_PATH = '/bills';

export type BillCategory = 'electricity' | 'airtime-data' | 'cable-tv' | 'internet';

export type BillPaymentConfig = {
  apiKey: string;
  apiBase?: string;
  validatePath?: string;
  payPath?: string;
};

export type ValidateCustomerRequest = {
  category: BillCategory;
  /** Meter number, phone number, or decoder/smart-card number, depending on
   * `category` — never a settlement address, this is a biller-side
   * reference only. */
  customerIdentifier: string;
  /** The specific biller's item code, from the category-listing endpoint —
   * left as a plain string here since this module doesn't fetch that list
   * itself (see header comment: the listing/validate/pay split is real,
   * this file only wires the validate+pay steps a screen actually calls). */
  itemCode: string;
};

/** Flutterwave's envelope around a validate answer. */
const validateEnvelopeSchema = z.object({
  status: z.string(),
  data: z.object({
    response_code: z.string(),
    response_message: z.string(),
    name: z.string().min(1),
  }),
});

export type ValidateCustomerResponse = {
  responseCode: string;
  responseMessage: string;
  customerName: string;
};

export type PayBillRequest = {
  category: BillCategory;
  customerIdentifier: string;
  itemCode: string;
  /** Integer minor units, same as everywhere else in this codebase — never
   * a float. */
  amountMinor: number;
  /** Idempotency reference this app generates, not the biller's. */
  reference: string;
};

/** Flutterwave's envelope around a payment answer. */
const payEnvelopeSchema = z.object({
  status: z.string(),
  data: z
    .object({
      reference: z.string().optional(),
      tx_ref: z.string().optional(),
      code: z.string().optional(),
    })
    .optional(),
});

export type PayBillResponse = {
  reference: string;
  billerReference: string;
  status: 'successful' | 'pending' | 'failed';
};

function requireBillPaymentConfig(config: BillPaymentConfig | undefined): BillPaymentConfig {
  if (!config?.apiKey) {
    throw new Error(
      'Bill payment is not configured — set a bill-payment aggregator API key, and confirm the real ' +
        'endpoint shape against developer.flutterwave.com/docs/bill-payment before relying on this in production.',
    );
  }
  return config;
}

/**
 * Confirms a customer identifier resolves to a real biller account before
 * money moves — e.g. "this meter number belongs to Chidi Okafor." Every
 * response is Zod-validated before use.
 */
export async function validateCustomer(
  request: ValidateCustomerRequest,
  config?: BillPaymentConfig,
): Promise<ValidateCustomerResponse> {
  const resolved = requireBillPaymentConfig(config);
  const base = resolved.apiBase ?? BILL_DEFAULT_API_BASE;

  const response = await fetch(`${base}${resolved.validatePath ?? BILL_VALIDATE_PATH}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${resolved.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_code: request.itemCode, customer_id: request.customerIdentifier }),
  });
  if (!response.ok) throw new Error(`Bill validation failed: ${response.status}`);
  const body: unknown = await response.json();
  const { data } = validateEnvelopeSchema.parse(body);
  return { responseCode: data.response_code, responseMessage: data.response_message, customerName: data.name };
}

/** Settles a validated bill. Resolves only once the aggregator confirms —
 * same "no interim optimistic entry" rule `gateway.ts#submitPayment` keeps. */
export async function payBill(request: PayBillRequest, config?: BillPaymentConfig): Promise<PayBillResponse> {
  const resolved = requireBillPaymentConfig(config);
  const base = resolved.apiBase ?? BILL_DEFAULT_API_BASE;

  if (!Number.isInteger(request.amountMinor) || request.amountMinor <= 0) {
    throw new Error('A bill amount must be a positive whole number of kobo.');
  }

  const response = await fetch(`${base}${resolved.payPath ?? BILL_PAY_PATH}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${resolved.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      country: 'NG',
      customer_id: request.customerIdentifier,
      // Flutterwave takes naira, this codebase holds kobo: converted only here.
      amount: request.amountMinor / 100,
      reference: request.reference,
    }),
  });
  if (!response.ok) throw new Error(`Bill payment failed: ${response.status}`);
  const body: unknown = await response.json();
  const envelope = payEnvelopeSchema.parse(body);

  const reference = envelope.data?.reference ?? envelope.data?.tx_ref ?? request.reference;
  return {
    reference,
    billerReference: envelope.data?.code ?? envelope.data?.tx_ref ?? reference,
    status: envelope.status === 'success' ? 'successful' : envelope.status === 'pending' ? 'pending' : 'failed',
  };
}
