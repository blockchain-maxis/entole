'use client';

import { Gauge, Hand, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Header } from '@/components/Header';
import { useAssistant } from '@/lib/assistant';

const POINTS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Gauge,
    title: 'It only spends what you allow',
    body: 'Each thing it can do is an allowance: an amount, how often it resets, and a balance that only goes down as it is used. When the balance is gone, it stops.',
  },
  {
    icon: Hand,
    title: 'You can stop it in one click',
    body: 'The Assistant chip at the top of every page pauses it right away. Your allowances stay exactly as they are.',
  },
  {
    icon: ShieldCheck,
    title: 'You still send money yourself',
    body: 'Turning it on changes nothing about how you pay people. Leave it off and Entole never moves money on its own.',
  },
];

/**
 * Where the assistant is explained and approved. It is a setting the person
 * turns on, never a default — so this is the only place its second passkey
 * confirmation happens, and signing in never asks for it.
 */
export default function AssistantPage() {
  const router = useRouter();
  const assistant = useAssistant();
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function turnOn() {
    setWorking(true);
    setProblem(null);
    try {
      const result = await assistant.enable();
      if (!result.ok) setProblem(result.reason);
    } finally {
      setWorking(false);
    }
  }

  function turnOff() {
    setProblem(null);
    assistant.disable();
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Assistant" back="/me" />

      <div className="flex-1 px-gutter pb-28 pt-2">
        <span className="inline-block rounded-md bg-indigo-wash px-2 py-1 font-heavy text-badge uppercase text-indigo">
          {assistant.enabled ? 'On' : 'Off'}
        </span>

        <h2 className="mt-4 font-strong text-headline text-ink">
          {assistant.enabled ? 'The assistant is on' : 'Let Entole pay for you, within limits'}
        </h2>
        <p className="mt-2.5 font-body text-body-sm text-slate">
          {assistant.enabled
            ? 'It can propose and make payments for you, only inside the allowances you set. Turn it off any time and it stops proposing anything.'
            : 'The assistant can propose and make payments for you, like a bill that comes round every month. It is off until you turn it on here.'}
        </p>

        <ul className="mt-7 flex flex-col gap-5">
          {POINTS.map((point) => (
            <li key={point.title} className="flex gap-3.5">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-control bg-indigo-wash text-indigo">
                <point.icon size={20} strokeWidth={1.75} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-strong text-body text-ink">{point.title}</p>
                <p className="mt-1 font-body text-body-sm text-slate">{point.body}</p>
              </div>
            </li>
          ))}
        </ul>

        {assistant.enabled ? null : (
          <p className="mt-7 font-body text-label-sm text-mist">
            Turning it on asks you to confirm with your passkey once more.
          </p>
        )}
        {problem ? <p className="mt-4 font-body text-label-sm text-halt">{problem}</p> : null}

        <div className="mt-8 flex gap-2.5">
          {assistant.enabled ? (
            <>
              <button
                type="button"
                onClick={turnOff}
                className="flex h-14 flex-1 items-center justify-center rounded-control border border-line bg-card font-strong text-body-lg text-ink transition-colors hover:border-mist"
              >
                Turn off the assistant
              </button>
              <button
                type="button"
                onClick={() => router.replace('/')}
                className="flex h-14 items-center justify-center rounded-control px-5 font-strong text-body-lg text-slate"
              >
                Done
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={working || assistant.loading}
              onClick={() => void turnOn()}
              className="flex h-14 flex-1 items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep disabled:opacity-60"
            >
              {working ? 'Confirming' : 'Turn on the assistant'}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
