/**
 * The mark that separates an assistant-initiated payment from one you made
 * yourself. It appears wherever such a payment is listed.
 */
export function AssistantBadge() {
  return (
    <span className="rounded-chip bg-indigo px-1.5 py-0.5 font-heavy text-badge uppercase tracking-wide text-paper">
      Entole
    </span>
  );
}
