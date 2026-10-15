import { concat, encodeAbiParameters, keccak256, slice, toHex, type Address, type Hex } from 'viem';

/**
 * How a payment says which invoice it pays, with nothing added to the
 * contract. Every payment through the router carries a 32-byte salt the payer
 * chooses. A payment made from an invoice link puts the invoice's tag in the
 * first half of it and randomness in the second, so two payments of one
 * invoice are still two payments. The business works the tag out from its own
 * account and the invoice's reference, and so knows a payment for that
 * invoice when it sees one, with no field on the link and no server involved.
 *
 * Only a payment through the router carries one. A card or bank payment, or
 * one sent another way, is still marked paid by hand.
 */

/** The first sixteen bytes of every salt paying this invoice. */
export function invoiceTag(business: Address, reference: string): Hex {
  const hash = keccak256(
    encodeAbiParameters(
      [{ type: 'string' }, { type: 'address' }, { type: 'string' }],
      ['entole.invoice', business, reference.trim().toUpperCase()],
    ),
  );
  return slice(hash, 0, 16);
}

/** A salt for a payment of this invoice: its tag, then sixteen random bytes. */
export function invoiceSalt(business: Address, reference: string): Hex {
  return concat([invoiceTag(business, reference), toHex(crypto.getRandomValues(new Uint8Array(16)))]);
}

/** Whether a payment's salt says it pays this invoice. */
export function saltPaysInvoice(salt: string | null | undefined, business: Address, reference: string): boolean {
  if (!salt || !/^0x[0-9a-fA-F]{64}$/.test(salt)) return false;
  return salt.slice(0, 34).toLowerCase() === invoiceTag(business, reference).toLowerCase();
}
