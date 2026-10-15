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
    body: 'Talking to it changes nothing about how you pay people. Without an allowance, Entole never moves money on its own.',
  },
];

/**
 * Where the assistant is explained and turned on, in two parts.
 *
 * Talking to it is free of ceremony: it reads what was said and works the
 * app, and every payment it gets ready is still confirmed by the person. So
 * turning that on asks for nothing.
 *
 * Paying inside allowances is the part that needs its own key, so it is the
 * only part that asks for the passkey once more. It is offered here when
 * there are allowances for it already, and otherwise happens the first time
 * the person writes one. Signing in never asks for it.
 */
export default function AssistantPage() {
  const router = useRouter();
  const store = useStore();
  const assistant = useAssistant();
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function letItPay() {
    setWorking(true);
    setProblem(null);
    try {
      const result = await assistant.enable();
      if (!result.ok) setProblem(result.reason);
    } finally {
      setWorking(false);
    }
  }

  function stopPaying() {
    setProblem(null);
    assistant.disable();
  }

  const anyOn = assistant.talking || assistant.enabled;
  const hasAllowances = store.allowances.length > 0;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Assistant" back="/me" />

      <div className="flex-1 px-gutter pb-28 pt-2">
        <h2 className="font-display text-subhead text-ink">
          {anyOn ? 'Your assistant' : 'An assistant that works the app for you'}
        </h2>
        <p className="mt-2.5 text-pretty font-body text-ui text-slate">
          Say or type what you need. It opens the screen, picks the person and fills in the amount. Anything that
          moves your money, you confirm yourself, unless it is inside an allowance you wrote.
        </p>

        <ul className="mt-6 border-t border-hairline">
          <li className="border-b border-hairline py-4">
            <div className="flex items-baseline justify-between gap-4">
              <p className="font-strong text-ui text-ink">Talks with you</p>
              <p className="font-strong text-note text-indigo">{assistant.talking ? 'On' : 'Off'}</p>
            </div>
            <p className="mt-1 text-pretty font-body text-note text-slate">
              {assistant.talking
                ? 'The microphone is beside the assistant’s control at the top of every page.'
                : 'Turning this on asks for nothing. It cannot move money by talking.'}
            </p>
            <button
              type="button"
              disabled={assistant.loading}
              onClick={assistant.talking ? assistant.stopTalking : assistant.startTalking}
              className={`mt-3 flex h-12 items-center justify-center rounded-control px-5 font-strong text-ui transition-colors active:translate-y-px disabled:opacity-60 ${
                assistant.talking
                  ? 'border border-line bg-card text-ink hover:border-mist'
                  : 'bg-ink text-paper hover:bg-ink/85'
              }`}
            >
              {assistant.talking ? 'Stop talking' : 'Start talking'}
            </button>
          </li>

          <li className="border-b border-hairline py-4">
            <div className="flex items-baseline justify-between gap-4">
              <p className="font-strong text-ui text-ink">Pays inside allowances</p>
              <p className="font-strong text-note text-indigo">{assistant.enabled ? 'On' : 'Off'}</p>
            </div>
            <p className="mt-1 text-pretty font-body text-note text-slate">
              {assistant.enabled
                ? `It pays only inside the allowances you write, and each payment waits ${ASK_UNDO_SECONDS} seconds for you to stop it.`
                : hasAllowances
                  ? 'Your allowances are there. Let it pay inside them; that asks you to confirm with your passkey once more.'
                  : 'Write it an allowance and it can pay inside it, never past it. Your first one asks you to confirm with your passkey once more.'}
            </p>
            {assistant.enabled ? (
              <button
                type="button"
                onClick={stopPaying}
                className="mt-3 flex h-12 items-center justify-center rounded-control border border-line bg-card px-5 font-strong text-ui text-ink transition-colors hover:border-mist active:translate-y-px"
              >
                Stop it paying
              </button>
            ) : hasAllowances ? (
              <button
                type="button"
                disabled={working || assistant.loading}
                onClick={() => void letItPay()}
                className="mt-3 flex h-12 items-center justify-center rounded-control bg-ink px-5 font-strong text-ui text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:opacity-60"
              >
                {working ? 'Confirming' : 'Let it pay inside them'}
              </button>
            ) : (
              <Link
                href="/rules/new"
                className="mt-3 inline-flex h-12 items-center justify-center rounded-control bg-ink px-5 font-strong text-ui text-paper transition-colors hover:bg-ink/85 active:translate-y-px"
              >
                Write an allowance
              </Link>
            )}
          </li>
        </ul>

        {problem ? <p className="mt-4 font-body text-note text-halt">{problem}</p> : null}

        {assistant.enabled ? <AskAssistant /> : null}

        <ul className="mt-7 flex flex-col gap-5">
          {POINTS.map((point) => (
            <li key={point.title} className="flex gap-3.5">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-control bg-indigo-wash text-indigo">
                <point.icon size={20} strokeWidth={1.75} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-strong text-ui text-ink">{point.title}</p>
                <p className="mt-1 font-body text-ui text-slate">{point.body}</p>
              </div>
            </li>
          ))}
        </ul>

        {anyOn ? (
          <button
            type="button"
            onClick={() => router.replace('/')}
            className="mt-8 flex h-14 w-full items-center justify-center rounded-control border border-line bg-card font-strong text-prose text-ink transition-colors hover:border-mist"
          >
            Done
          </button>
        ) : null}
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
    return <Skeleton className="mt-6 h-[188px] w-full rounded-card" />;
  }

  if (store.allowances.length === 0) {
    return (
      <section className="mt-6 rounded-card bg-indigo-wash p-5">
        <p className="font-strong text-ui text-ink">Nothing for it to do yet</p>
        <p className="mt-1 font-body text-ui text-slate">
          Set an allowance for someone and you can ask the assistant to pay them.
        </p>
        <Link href="/rules/new" className="mt-3 inline-block font-strong text-ui text-ink underline decoration-mist underline-offset-4 hover:decoration-ink">
          Set up an allowance
        </Link>
      </section>
    );
  }

  return (
    <form onSubmit={(event) => void ask(event)} className="mt-6 rounded-card bg-indigo-wash p-5">
      <label htmlFor="ask" className="block font-strong text-ui text-ink">
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
        className={`mt-3 h-14 w-full rounded-control border-[1.5px] bg-card px-4 font-body text-ui text-ink outline-none placeholder:text-mist focus:border-ink ${
          problem ? 'border-halt' : 'border-line'
        }`}
      />
      <p id="ask-help" role={problem ? 'alert' : undefined} className={`mt-2 font-body text-note ${problem ? 'text-halt' : 'text-slate'}`}>
        {problem ?? `Say who and how much. You get ${ASK_UNDO_SECONDS} seconds to stop it before it is sent.`}
      </p>
      <button
        type="submit"
        disabled={working || text.trim().length === 0}
        className="mt-4 flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:opacity-60"
      >
        {working ? 'Starting' : 'Ask the assistant'}
      </button>
    </form>
  );
}
