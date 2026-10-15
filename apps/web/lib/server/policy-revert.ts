/**
 * What went wrong when the policy contract refused, by its error name, as a
 * short code a client can act on. Never raw RPC text.
 */
export function policyRevertCode(error: unknown): string {
  const text = (
    error instanceof Error
      ? `${(error as { shortMessage?: string }).shortMessage ?? ''} ${error.message}`
      : String(error)
  ).toLowerCase();
  if (text.includes('signatureexpired')) return 'expired';
  if (text.includes('badsignature') || text.includes('notallowedtocancel')) return 'invalid_signature';
  if (text.includes('tooearly')) return 'too_early';
  if (text.includes('runexpired')) return 'stale';
  if (text.includes('nosuchrun')) return 'gone';
  if (text.includes('undowindowrequired')) return 'undo_required';
  if (text.includes('transferfailed') || text.includes('balance') || text.includes('allowance')) {
    return 'insufficient_funds';
  }
  if (
    ['overperrunmax', 'overperiodcap', 'recipientnotallowed', 'accountpaused', 'alreadyrevoked', 'runvoid', 'expired', 'notdelegate'].some(
      (name) => text.includes(name),
    )
  ) {
    return 'over_limit';
  }
  return 'rejected';
}
