import { Header } from '@/components/Header';

/** Placeholder — real terms of service need legal review before ship. */
export default function TermsPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Terms" back="/me" />
      <div className="flex-1 px-gutter pb-28">
        <p className="font-body text-body-sm text-slate">
          Placeholder — Entole&apos;s terms of service go here once written and reviewed. Nothing
          on this page is a real legal document yet.
        </p>
      </div>
    </main>
  );
}
