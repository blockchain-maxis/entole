'use client';

import Link from 'next/link';

import { useAssistant } from '@/lib/assistant';

import { Skeleton } from './Skeleton';

/**
 * What the allowances section shows before there is one. It teaches the idea
 * with a single example of how an allowance reads, in the assistant's blue,
 * and leads to the next real step: writing the first allowance, which is also
 * what lets the assistant pay (it is a setting, never a default).
 * There is nothing to dismiss; it goes when an allowance exists.
 */
export function AllowanceIntro() {
  const assistant = useAssistant();

  if (assistant.loading) return <Skeleton className="h-[196px] w-full rounded-card" />;

  return (
    <section className="rounded-card bg-indigo-wash p-5">
      <p className="font-body text-note text-slate">An allowance reads like this</p>
      <p className="mt-2 text-pretty font-display-plain text-subhead text-indigo">
        Send ₦50,000 to Mum every month, never more than ₦100,000 a month.
      </p>
      <p className="mt-3 text-pretty font-body text-ui text-slate">
        {assistant.enabled
          ? 'Write one, and the assistant can pay inside it and never past it.'
          : 'You write it once. The assistant can then pay inside it and never past it. Writing the first one asks for your passkey once more.'}
      </p>
      <Link
        href="/rules/new"
        className="mt-4 inline-flex h-12 items-center justify-center rounded-control bg-ink px-5 font-strong text-ui text-paper transition-colors hover:bg-ink/85 active:translate-y-px"
      >
        Write your first allowance
      </Link>
    </section>
  );
}
