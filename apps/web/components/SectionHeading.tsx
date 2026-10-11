import Link from 'next/link';

/**
 * A section's name, in the display face, with at most one quiet action beside
 * it. The action is a link in ink: blue is kept for the assistant.
 */
export function SectionHeading({
  title,
  action,
}: {
  title: string;
  action?: { label: string; href: string } | undefined;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 pb-3 pt-10">
      <h2 className="font-display text-subhead text-ink">{title}</h2>
      {action ? (
        <Link
          href={action.href}
          className="flex-none font-strong text-ui text-ink underline decoration-mist underline-offset-4 transition-colors hover:decoration-ink"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
