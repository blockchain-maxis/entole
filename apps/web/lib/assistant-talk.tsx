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
import {
  canRecord,
  deviceListeningReady,
  listenOnDevice,
  preferDeviceListening,
  prefersDeviceListening,
  prepareDeviceListening,
} from './device-listening';
import { canListen, listen, primeSpeech, speak, stopSpeaking } from './voice';

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
  // Saved people, to add, rename or remove.
  people: '/beneficiaries',
  'new-allowance': '/rules/new',
  assistant: '/assistant',
  me: '/me',
};

function screenAt(pathname: string): AssistantScreen | undefined {
  const match = (Object.entries(ROUTES) as [AssistantScreen, string][]).find(([, route]) => route === pathname);
  return match?.[0];
}

export type TalkTurn = { from: 'you' | 'assistant'; text: string };
/** `writing` is the device turning a recording into words; `reading` is working out what they mean. */
export type TalkPhase = 'idle' | 'listening' | 'writing' | 'reading';

/**
 * How this browser listens: by itself, with the model on the device, or not
 * at all. Asked fresh each time, since trying the device model is remembered.
 */
export type ListeningWay = 'browser' | 'device' | 'none';

function listeningWay(): ListeningWay {
  if (canListen() && !prefersDeviceListening()) return 'browser';
  if (canRecord()) return 'device';
  return canListen() ? 'browser' : 'none';
}

/** Getting the device ready to listen: offered, on its way, or stopped part-way. */
export type ListeningSetup = { state: 'offer' | 'loading' | 'failed'; fraction: number };

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
  /** Set while the device's own listening is being offered or fetched. */
  setup: ListeningSetup | null;
  /** Yes to listening on the device: fetches the model once. */
  getListening: () => Promise<void>;
  dismissSetup: () => void;
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
  const { talking, enabled } = useAssistant();

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<TalkPhase>('idle');
  const [hearing, setHearing] = useState('');
  const [turns, setTurns] = useState<TalkTurn[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [setup, setSetup] = useState<ListeningSetup | null>(null);
  // Asked of the browser once it is there; the server render assumes it cannot.
  const way = useSyncExternalStore(noSubscription, listeningWay, () => 'none' as const);
  const hears = way !== 'none';
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
          const query = new URLSearchParams();
          if (step.category) query.set('category', step.category);
          if (step.amountMinor !== undefined) query.set('amount', String(step.amountMinor));
          router.push(query.size ? `/transfer/bill?${query.toString()}` : '/transfer/bill');
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

  const heardThen = useCallback(
    (text: string) => {
      listening.current = null;
      void ask(text);
    },
    [ask],
  );

  const startListening = useCallback(() => {
    if (listening.current) return;
    primeSpeech();
    stopSpeaking();
    setProblem(null);
    setHearing('');

    if (listeningWay() === 'device') {
      if (!deviceListeningReady()) {
        setSetup({ state: 'offer', fraction: 0 });
        return;
      }
      setSetup(null);
      listening.current = listenOnDevice({
        onWriting: () => setPhase('writing'),
        onEnd: (why, text) => {
          if (why === 'heard' && text) {
            heardThen(text);
            return;
          }
          listening.current = null;
          setPhase('idle');
          if (why === 'not-allowed') {
            setProblem("This browser won't share the microphone. Allow it for this site, type instead, or open entole.pro in Chrome.");
          } else if (why === 'no-microphone') setProblem('No microphone was found. Type what you need instead.');
          else if (why === 'failed') setProblem("I couldn't make out the recording. Try again, or type instead.");
          else setProblem("I didn't hear anything. Tap the microphone and try again.");
        },
      });
      setPhase('listening');
      return;
    }

    const session = listen({
      onWords: setHearing,
      onEnd: (why, text) => {
        if (why === 'heard' && text) {
          heardThen(text);
          return;
        }
        listening.current = null;
        setPhase('idle');
        setHearing('');
        if (why === 'not-allowed') setProblem('The microphone is off for this site. Turn it on in the browser, or type instead.');
        else if (why === 'failed' && canRecord()) {
          // The browser's own listening is there and did not work: offer the device's.
          setProblem("This browser's listening didn't work.");
          setSetup({ state: 'offer', fraction: 0 });
        } else if (why === 'failed') setProblem("I couldn't listen just now. Try again, or type instead.");
        else setProblem("I didn't hear anything. Tap the microphone and try again.");
      },
    });
    if (!session) {
      setProblem("This browser can't listen. Type what you need instead.");
      return;
    }
    listening.current = session;
    setPhase('listening');
  }, [heardThen]);

  const getListening = useCallback(async () => {
    preferDeviceListening();
    setProblem(null);
    setSetup({ state: 'loading', fraction: 0 });
    try {
      await prepareDeviceListening((fraction) => setSetup({ state: 'loading', fraction }));
      setSetup(null);
      say('Listening is ready on this phone. Tap the microphone and tell me what you need.');
    } catch {
      setSetup({ state: 'failed', fraction: 0 });
    }
  }, [say]);

  const dismissSetup = useCallback(() => setSetup(null), []);

  const show = useCallback(() => {
    primeSpeech();
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
    // A download on its way carries on and is shown again on return; an offer is put away.
    setSetup((current) => (current?.state === 'loading' ? current : null));
  }, []);

  const clearLine = useCallback(() => setLine(null), []);

  // Stopping talking, or signing out, puts all of this away.
  const active = talking && Boolean(account);
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
      setup,
      getListening,
      dismissSetup,
      problem,
      startListening,
      stopListening,
      ask,
      line: active ? line : null,
      clearLine,
    }),
    [
      open,
      active,
      show,
      hide,
      phase,
      hearing,
      turns,
      hears,
      setup,
      getListening,
      dismissSetup,
      problem,
      startListening,
      stopListening,
      ask,
      line,
      clearLine,
    ],
  );

  return <TalkContext.Provider value={value}>{children}</TalkContext.Provider>;
}
