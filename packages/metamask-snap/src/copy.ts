/**
 * Every string a MetaMask user actually reads from this Snap. Kept in one
 * file so the banned-word rule (see repo root CLAUDE.md — no wallet, crypto,
 * blockchain, chain, gas, token, on-chain, signature, transaction hash in
 * user-facing copy) is easy to audit by reading top to bottom. MetaMask's
 * own surrounding UI chrome uses those words freely; that's MetaMask's copy,
 * not this Snap's, and out of this file's control.
 *
 * A raw settlement address is never interpolated into any string here —
 * every grant/redeem/revoke dialog describes recipients by count, never by
 * address, matching the same hard rule Entole's own apps follow.
 */

export function grantDialogTitle(): string {
  return "Let Entole's assistant pay for you";
}

export function grantDialogBody(params: {
  recipientCount: number;
  perRunMax: string;
  periodCap: string;
  periodLabel: string;
  expiresLabel: string;
}): string {
  const { recipientCount, perRunMax, periodCap, periodLabel, expiresLabel } = params;
  const who = recipientCount === 1 ? '1 person' : `${recipientCount} people`;
  return [
    `You're about to let Entole's assistant pay ${who} on your behalf.`,
    `Up to ${perRunMax} per payment, never more than ${periodCap} ${periodLabel}.`,
    `This permission ends ${expiresLabel}, or the moment you revoke it — whichever comes first.`,
    'The assistant can never exceed this limit. It is enforced by the contract you are about to approve, not by a promise from Entole.',
  ].join('\n\n');
}

export function redeemDialogTitle(): string {
  return 'Entole wants to make a payment';
}

export function redeemDialogBody(params: { amount: string }): string {
  return [
    `Entole's assistant is proposing a payment of ${params.amount}.`,
    'This spends inside the limit you already approved — approving here settles it now.',
  ].join('\n\n');
}

export function revokeDialogTitle(): string {
  return "Stop Entole's assistant";
}

export function revokeDialogBody(): string {
  return [
    "This ends the assistant's permission immediately.",
    'Nothing it proposes after this can settle, on this permission or any future one you have not separately approved.',
  ].join('\n\n');
}

export function approvedFooter(): string {
  return 'You can end this at any time from the same place you granted it.';
}
