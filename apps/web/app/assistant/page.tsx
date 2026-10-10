'use client';

import { Gauge, Hand, ShieldCheck, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { ASK_UNDO_SECONDS, proposeFromRequest } from '@entole/core/assistant-ask';
import { useBackend } from '@entole/core/backend';
import { useStore } from '@entole/core/store';

import { Header } from '@/components/Header';
import { Skeleton } from '@/components/Skeleton';
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

        {assistant.enabled ? <AskAssistant /> : null}

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

/**
 * Asking the assistant to pay someone. A sentence becomes a proposal, and the
 * proposal runs the same undo window as any other: this never sends anything
 * itself. Whether the payment may happen is the allowance's decision, made
 * when the assistant tries to run it.
 */
function AskAssistant() {
  const router = useRouter();
  const store = useStore();
  const { proposals } = useBackend();
  const [text, setText] = useState('');
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (working) return;
    const result = proposeFromRequest(text, { contacts: store.contacts, allowances: store.allowances });
    if (!result.ok) {
      setProblem(result.reason);
      return;
    }
    setProblem(null);
    setWorking(true);
    proposals.put(result.proposal);
    try {
      // Re-reading the account is what makes it the waiting payment.
      await store.refresh();
      router.push('/assistant/action');
    } catch {
      proposals.clear();
      setProblem("We couldn't start that. Nothing was sent. Try again.");
      setWorking(false);
    }
  }

  if (store.status === 'loading') {
    return <Skeleton className="mt-6 h-[188px] w-full rounded-panel" />;
  }

  if (store.allowances.length === 0) {
    return (
      <section className="mt-6 rounded-panel bg-indigo-wash p-5">
        <p className="font-strong text-body text-ink">Nothing for it to do yet</p>
        <p className="mt-1 font-body text-body-sm text-slate">
          Set an allowance for someone and you can ask the assistant to pay them.
        </p>
        <Link href="/rules/new" className="mt-3 inline-block font-strong text-label text-indigo hover:text-indigo-deep">
          Set up an allowance
        </Link>
      </section>
    );
  }

  return (
    <form onSubmit={(event) => void ask(event)} className="mt-6 rounded-panel bg-indigo-wash p-5">
      <label htmlFor="ask" className="block font-strong text-body text-ink">
        Ask it to pay someone
      </label>
      <input
        id="ask"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setProblem(null);
        }}
        placeholder="Pay 5000 to Ada for rent"
        autoComplete="off"
        autoCapitalize="sentences"
        enterKeyHint="send"
        aria-describedby="ask-help"
        className={`mt-3 h-14 w-full rounded-control border-[1.5px] bg-card px-4 font-body text-body text-ink outline-none placeholder:text-mist focus:border-indigo ${
          problem ? 'border-halt' : 'border-line'
        }`}
      />
      <p id="ask-help" role={problem ? 'alert' : undefined} className={`mt-2 font-body text-caption ${problem ? 'text-halt' : 'text-slate'}`}>
        {problem ?? `Say who and how much. You get ${ASK_UNDO_SECONDS} seconds to stop it before it is sent.`}
      </p>
      <button
        type="submit"
        disabled={working || text.trim().length === 0}
        className="mt-4 flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep active:translate-y-px disabled:opacity-60"
      >
        {working ? 'Starting' : 'Ask the assistant'}
      </button>
    </form>
  );
}
