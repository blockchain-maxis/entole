'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { LEGAL_CONTACT, type LegalDocument } from '@entole/core/legal';

import { CheckoutHeader } from './CheckoutHeader';

/**
 * The Terms or the Privacy notice, set to be read: one column, a serif lead,
 * ruled sections. These pages are public, so someone can read them before
 * making an account; `CheckoutHeader` still draws the pause control for anyone
 * who is signed in. The words come from `@entole/core/legal`, the same ones the
 * phone shows.
 */
export function LegalPage({
  document,
  other,
}: {
  document: LegalDocument;
  /** The sister page, offered at the end. */
  other: { label: string; href: string };
}) {
  const router = useRouter();

  // Back to wherever they were reading from: Me, the first page, the sign-up
  // step. Opened cold in a new tab there is nowhere to go back to, so go home.
  function back() {
    if (window.history.length > 1) router.back();
    else router.push('/');
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[680px] flex-col px-gutter pb-20">
      <CheckoutHeader />

      <article className="pt-4">
        <button
          type="button"
          onClick={back}
          className="-ml-1 flex items-center gap-1.5 rounded-control px-1 py-1 font-strong text-note text-slate transition-colors hover:text-ink"
        >
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
          Back
        </button>

        <h1 className="mt-5 font-display text-heading text-ink">{document.title}</h1>
        <p className="mt-1.5 font-body text-note text-slate">Last updated {document.updated}</p>
        <p className="mt-6 max-w-[60ch] text-pretty font-display-plain text-prose text-ink">{document.lead}</p>

        {document.sections.map((section) => (
          <section key={section.heading} className="mt-8 border-t border-hairline pt-6">
            <h2 className="font-display text-subhead text-ink">{section.heading}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph} className="mt-3 max-w-[65ch] text-pretty font-plain text-prose text-ink">
                {paragraph}
              </p>
            ))}
          </section>
        ))}

        <footer className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-hairline pt-6">
          <Link
            href={other.href}
            className="font-strong text-ui text-ink underline decoration-mist underline-offset-4 transition-colors hover:decoration-ink"
          >
            {other.label}
          </Link>
          <a
            href={`mailto:${LEGAL_CONTACT}`}
            className="font-body text-ui text-slate underline decoration-mist underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
          >
            {LEGAL_CONTACT}
          </a>
        </footer>
      </article>
    </main>
  );
}
