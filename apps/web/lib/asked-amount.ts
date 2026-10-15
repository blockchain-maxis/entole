/**
 * An amount a link or the assistant put in the address (`?amount=`, in kobo),
 * when it is one. Anything else is no amount, and the keypad starts empty.
 */
export function askedMinor(value: string | null): number | undefined {
  if (!value || !/^\d{1,13}$/.test(value)) return undefined;
  const minor = Number(value);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : undefined;
}
