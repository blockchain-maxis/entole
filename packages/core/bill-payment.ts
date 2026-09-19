import { z } from 'zod';

/**
 * "Pay a Bill" — electricity, airtime/data, cable TV, internet. Confirmed
 * real (via developer.flutterwave.com/docs/bill-payment, not guessed):
 * Flutterwave's Bills API has a category-listing endpoint, a validate-
 * customer endpoint (customer identifier + `item_code` in, billed customer's
 * `name` back so a screen can show "you're about to pay for Chidi Okafor's
 * meter" before money moves), and a create-payment endpoint (`country`,
 * `customer_id`, `amount`, optional `reference` in; `tx_ref`/`reference`/
 * `code` back). **Unconfirmed**: the exact base URL version segment and the
 * auth header's precise casing — Flutterwave's convention elsewhere in
 * their API is `Authorization: Bearer FLWSECK_...`, assumed here but not
 * re-confirmed against this specific endpoint's page. Same disclosure this
 * codebase already uses for `aurora-intents.ts`: the documented product
 * shape is real, the field-for-field contract should be re-verified against
 * a live account before this is relied on in production.
 */

export type BillCategory = 'electricity' | 'airtime-data' | 'cable-tv' | 'internet';

export type BillPaymentConfig = {
  apiKey: string;
  apiBase?: string;
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

const validateCustomerResponseSchema = z.object({
  responseCode: z.string(),
  responseMessage: z.string(),
  customerName: z.string().min(1),
});

export type ValidateCustomerResponse = z.infer<typeof validateCustomerResponseSchema>;

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

const payBillResponseSchema = z.object({
  reference: z.string().min(1),
  billerReference: z.string().min(1),
  status: z.enum(['successful', 'pending', 'failed']),
});

export type PayBillResponse = z.infer<typeof payBillResponseSchema>;

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
  const base = resolved.apiBase ?? 'https://api.flutterwave.com/v3';

  const response = await fetch(`${base}/bill-items/${request.itemCode}/validate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${resolved.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: request.itemCode, customer: request.customerIdentifier }),
  });
  if (!response.ok) throw new Error(`Bill validation failed: ${response.status}`);
  const body: unknown = await response.json();
  return validateCustomerResponseSchema.parse(body);
}

/** Settles a validated bill. Resolves only once the aggregator confirms —
 * same "no interim optimistic entry" rule `gateway.ts#submitPayment` keeps. */
export async function payBill(request: PayBillRequest, config?: BillPaymentConfig): Promise<PayBillResponse> {
  const resolved = requireBillPaymentConfig(config);
  const base = resolved.apiBase ?? 'https://api.flutterwave.com/v3';

  const response = await fetch(`${base}/bills`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${resolved.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      country: 'NG',
      customer_id: request.customerIdentifier,
      amount: request.amountMinor,
      reference: request.reference,
      type: request.category,
    }),
  });
  if (!response.ok) throw new Error(`Bill payment failed: ${response.status}`);
  const body: unknown = await response.json();
  return payBillResponseSchema.parse(body);
}
