'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  planReply,
  type AssistantFacts,
  type AssistantScreen,
  type AssistantStep,
} from '@entole/core/assistant-actions';
import { GRAMMAR_ONLY_HINT, NOT_UNDERSTOOD, type TurnHistory } from '@entole/core/assistant-brain';
import { useBackend } from '@entole/core/backend';
import { useStore } from '@entole/core/store';

import { useAccount } from './account';
import { useAssistant } from './assistant';
import { canListen, listen, speak, stopSpeaking } from './voice';

/**
 * Talking to the assistant, from any page.
 *
 * One thing said becomes, at most, a few things done: a screen opened, a
 * payment made ready, a fact read out. This is where that happens in the
 * browser. Reading the sentence and deciding what it means is shared with the
 * phone (`packages/core/assistant-actions.ts`, `assistant-brain.ts`); here it
 * is turned into this app's own navigation.
 *
 * What it can never do is in what this file does not have. It moves the person
 * to a screen with things filled in. It holds no way to press Confirm and no
 * way to answer the passkey prompt, so a payment the person has not confirmed
 * themselves cannot leave. The one payment it starts itself is inside an
 * allowance, and that goes to the undo screen like any other.
 */

/** Each screen the assistant knows, as this app's own address for it. */
const ROUTES: Record<AssistantScreen, string> = {
  home: '/',
  pay: '/transfer',
  send: '/transfer/send',
  receive: '/receive',
  'add-money': '/add-money',
  activity: '/activity',
  savings: '/grow/savings',
  stocks: '/grow/stocks',
  bills: '/transfer/bill',
  business: '/business',
  invoice: '/business/new-invoice',
  // People are saved from a receipt and listed where a payment starts.
  people: '/transfer',
  'new-allowance': '/rules/new',
  assistant: '/assistant',
  me: '/me',
};

function screenAt(pathname: string): AssistantScreen | undefined {
  const match = (Object.entries(ROUTES) as [AssistantScreen, string][]).find(([, route]) => route === pathname);
  return match?.[0];
}

export type TalkTurn = { from: 'you' | 'assistant'; text: string };
export type TalkPhase = 'idle' | 'listening' | 'reading';

type TalkValue = {
  open: boolean;
  show: () => void;
  hide: () => void;
  phase: TalkPhase;
  /** The words as they are being heard, before they are final. */
  hearing: string;
  turns: TalkTurn[];
  /** Whether this browser can listen at all. Where it cannot, the assistant is typed to. */
  hears: boolean;
  /** Why listening stopped without anything to act on, in plain words. */
  problem: string | null;
  startListening: () => void;
  stopListening: () => void;
  ask: (text: string) => Promise<void>;
  /** What the assistant last said after it took the person somewhere, shown once the sheet has gone. */
  line: string | null;
  clearLine: () => void;
};

const TalkContext = createContext<TalkValue | null>(null);

export function useAssistantTalk(): TalkValue {
  const value = useContext(TalkContext);
  if (!value) throw new Error('useAssistantTalk must be used inside AssistantTalkProvider');
  return value;
}

const noSubscription = () => () => undefined;

export function AssistantTalkProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const store = useStore();
  const backend = useBackend();
  const { account } = useAccount();
  const { enabled } = useAssistant();

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<TalkPhase>('idle');
  const [hearing, setHearing] = useState('');
  const [turns, setTurns] = useState<TalkTurn[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  // Asked of the browser once it is there; the server render assumes it cannot.
  const hears = useSyncExternalStore(noSubscription, canListen, () => false);
  const listening = useRef<{ stop: () => void } | null>(null);
  const turnsRef = useRef<TalkTurn[]>([]);

  const say = useCallback((text: string) => {
    turnsRef.current = [...turnsRef.current, { from: 'assistant' as const, text }].slice(-8);
    setTurns(turnsRef.current);
    speak(text);
  }, []);

  /** Carries the steps out. Returns true when the person was taken somewhere. */
  const carryOut = useCallback(
    async (steps: AssistantStep[]): Promise<boolean> => {
      let moved = false;
      for (const step of steps) {
        if (step.kind === 'say') continue;
        if (step.kind === 'open') {
          router.push(ROUTES[step.screen]);
          moved = true;
        } else if (step.kind === 'send') {
          const query = new URLSearchParams({ contact: step.contactId });
          if (step.amountMinor !== undefined) query.set('amount', String(step.amountMinor));
          if (step.note) query.set('note', step.note);
          router.push(`/transfer/send?${query.toString()}`);
          moved = true;
        } else if (step.kind === 'propose') {
          backend.proposals.put(step.proposal);
          await store.refresh().catch(() => undefined);
          router.push('/assistant/action');
          moved = true;
        } else if (step.kind === 'request') {
          router.push(step.amountMinor !== undefined ? `/receive?amount=${step.amountMinor}` : '/receive');
          moved = true;
        } else if (step.kind === 'savings') {
          const query = new URLSearchParams({ mode: step.mode });
          if (step.amountMinor !== undefined) query.set('amount', String(step.amountMinor));
          router.push(`/grow/savings?${query.toString()}`);
          moved = true;
        } else if (step.kind === 'bill') {
          router.push(step.category ? `/transfer/bill?category=${step.category}` : '/transfer/bill');
          moved = true;
        } else if (step.kind === 'pause') {
          await store.setPaused(step.paused);
        }
      }
      return moved;
    },
    [router, backend, store],
  );

  const ask = useCallback(
    async (spoken: string) => {
      const text = spoken.replace(/\s+/g, ' ').trim();
      if (!text || !account) return;
      stopSpeaking();
      setProblem(null);
      setHearing('');
      const history: TurnHistory = turnsRef.current.slice(-6);
      turnsRef.current = [...turnsRef.current, { from: 'you' as const, text }].slice(-8);
      setTurns(turnsRef.current);
      setPhase('reading');

      try {
        const heard = await backend.brain.read(text, { screen: screenAt(pathname), history });
        if (heard.kind !== 'reply') {
          say(heard.kind === 'grammar-only' ? GRAMMAR_ONLY_HINT : NOT_UNDERSTOOD);
          return;
        }

        const facts: AssistantFacts = {
          balanceMinor: store.balance,
          activity: store.activity,
          allowances: store.allowances,
          savingsMinor: store.growPosition?.balanceMinor ?? null,
          username: account.username || null,
          contactName: (id) => store.contact(id)?.name,
        };
        const steps = await planReply(
          heard.reply,
          { contacts: store.contacts, allowances: store.allowances, canSpend: enabled, paused: store.paused },
          facts,
          { directory: backend.directory, resolveContactId: backend.source.resolveContactId },
        );

        const moved = await carryOut(steps);
        const words = steps.flatMap((step) => (step.kind === 'say' ? [step.text] : []));
        const paused = steps.find((step) => step.kind === 'pause');
        if (paused?.kind === 'pause') words.push(paused.paused ? 'The assistant is paused.' : 'The assistant is back on.');
        const spokenLine = words.join(' ');
        if (spokenLine) say(spokenLine);
        if (moved) {
          // Out of the way, so the screen it opened can be seen. What it said stays a moment.
          setLine(spokenLine || null);
          setOpen(false);
        }
      } catch {
        say("That didn't work. Nothing was changed. Try again.");
      } finally {
        setPhase('idle');
      }
    },
    [account, backend, pathname, store, enabled, carryOut, say],
  );

  const stopListening = useCallback(() => {
    listening.current?.stop();
  }, []);

  const startListening = useCallback(() => {
    if (listening.current) return;
    stopSpeaking();
    setProblem(null);
    setHearing('');
    const session = listen({
      onWords: setHearing,
      onEnd: (why, text) => {
        listening.current = null;
        if (why === 'heard' && text) {
          void ask(text);
          return;
        }
        setPhase('idle');
        setHearing('');
        if (why === 'not-allowed') setProblem('The microphone is off for this site. Turn it on in the browser, or type instead.');
        else if (why === 'failed') setProblem("I couldn't listen just now. Try again, or type instead.");
        else setProblem("I didn't hear anything. Tap the microphone and try again.");
      },
    });
    if (!session) {
      setProblem("This browser can't listen. Type what you need instead.");
      return;
    }
    listening.current = session;
    setPhase('listening');
  }, [ask]);

  const show = useCallback(() => {
    setLine(null);
    setProblem(null);
    setOpen(true);
  }, []);

  const hide = useCallback(() => {
    listening.current?.stop();
    stopSpeaking();
    setOpen(false);
    setPhase('idle');
    setHearing('');
  }, []);

  const clearLine = useCallback(() => setLine(null), []);

  // Turning the assistant off, or signing out, puts all of this away.
  const active = enabled && Boolean(account);
  useEffect(() => {
    if (active) return;
    listening.current?.stop();
    stopSpeaking();
  }, [active]);

  const value = useMemo<TalkValue>(
    () => ({
      open: open && active,
      show,
      hide,
      phase,
      hearing,
      turns,
      hears,
      problem,
      startListening,
      stopListening,
      ask,
      line: active ? line : null,
      clearLine,
    }),
    [open, active, show, hide, phase, hearing, turns, hears, problem, startListening, stopListening, ask, line, clearLine],
  );

  return <TalkContext.Provider value={value}>{children}</TalkContext.Provider>;
}
