import { getAddress, hexToBytes, isAddress, keccak256, bytesToHex, type Address } from 'viem';

/**
 * The code someone shares so they can be paid: `PAY-XXXX-XXXX-…`.
 *
 * It is how an account is named to another person *without an address ever
 * appearing in the UI* — an address is inside the code, but the code is opaque
 * text (Crockford base32: no I, L, O or U, so it survives being read aloud and
 * retyped). The last two bytes are a checksum, so a mistyped code is refused
 * instead of quietly paying a stranger.
 *
 * This is different from `entoleCode` in `profile.ts`, which is a one-way label
 * for showing who someone is. This one is reversible, because it has to be.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PREFIX = 'PAY';
const ADDRESS_BYTES = 20;
const CHECKSUM_BYTES = 2;

function checksum(addressBytes: Uint8Array): Uint8Array {
  return hexToBytes(keccak256(addressBytes)).slice(0, CHECKSUM_BYTES);
}

function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(text: string, byteLength: number): Uint8Array | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) return null;
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return out.length >= byteLength ? Uint8Array.from(out.slice(0, byteLength)) : null;
}

/** `PAY-XXXX-XXXX-…` for an account. */
export function encodePaymentCode(address: Address): string {
  const bytes = hexToBytes(address);
  const body = toBase32(Uint8Array.from([...bytes, ...checksum(bytes)]));
  const groups = body.match(/.{1,4}/g) ?? [];
  return [PREFIX, ...groups].join('-');
}

/** The account a code names, or `null` for anything that isn't a valid code —
 * wrong length, a character outside the alphabet, or a failed checksum. Accepts
 * lowercase, spaces or dashes, and the usual look-alikes (O→0, I/L→1). */
export function decodePaymentCode(input: string): Address | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (!cleaned.startsWith(PREFIX)) return null;
  const body = cleaned.slice(PREFIX.length);
  const bytes = fromBase32(body, ADDRESS_BYTES + CHECKSUM_BYTES);
  if (!bytes) return null;
  // 22 bytes is 36 characters exactly; anything longer is a different string.
  if (body.length !== Math.ceil(((ADDRESS_BYTES + CHECKSUM_BYTES) * 8) / 5)) return null;

  const addressBytes = bytes.slice(0, ADDRESS_BYTES);
  const expected = checksum(addressBytes);
  if (bytes[ADDRESS_BYTES] !== expected[0] || bytes[ADDRESS_BYTES + 1] !== expected[1]) return null;

  const address = bytesToHex(addressBytes);
  return isAddress(address) ? getAddress(address) : null;
}
