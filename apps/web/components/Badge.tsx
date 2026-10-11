/**
 * The mark that separates an assistant-initiated payment from one you made
 * yourself. It appears wherever such a payment is listed.
 */
export function AssistantBadge() {
  return (
    <span className="flex-none rounded-pill bg-indigo px-1.5 py-0.5 font-heavy text-micro uppercase text-paper">
      Assistant
    </span>
  );
}
