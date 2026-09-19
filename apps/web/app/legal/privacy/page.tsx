import { Header } from '@/components/Header';

/** Placeholder — a real privacy notice needs legal review before ship. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Privacy" back="/me" />
      <div className="flex-1 px-gutter pb-28">
        <p className="font-body text-body-sm text-slate">
          Placeholder — Entole&apos;s privacy notice goes here once written and reviewed. Nothing
          on this page is a real legal document yet.
        </p>
      </div>
    </main>
  );
}
