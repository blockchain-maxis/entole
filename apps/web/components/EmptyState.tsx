import Link from 'next/link';

/**
 * What a list says when there is nothing in it yet: what would fill it, and,
 * where there is one, a way to. Plain words on paper, never a blank space
 * under a heading.
 */
export function EmptyState({
  body,
  action,
}: {
  body: string;
  action?: { label: string; href: string } | undefined;
}) {
  return (
    <div className="border-y border-hairline py-5">
      <p className="text-pretty font-body text-ui text-slate">{body}</p>
      {action ? (
        <Link
          href={action.href}
          className="mt-2 inline-block font-strong text-ui text-ink underline decoration-mist underline-offset-4 transition-colors hover:decoration-ink"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
