import * as Haptics from 'expo-haptics';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { TurnHistory } from '@entole/core/assistant-brain';
import { ACCENTS, CONFIRM_LINE, DEFAULT_ACCENT_ID, wakeReply, type Accent } from '@entole/core/assistant-persona';

import { useAccount } from './account';
import { useAssistant } from './assistant';
import { useAssistantRunner } from './assistant-run';
import { onConfirmation } from './confirm-announce';
import { isWakeOn, loadAccentId, saveAccentId, saveWakeOn } from './session';
import { canListen, canSpeak, listen, setVoiceAccent, speakAndWait, stopSpeaking, watchForWake } from './voice';

/**
 * The assistant as a presence, not a screen.
 *
 * There is no chat to open. The person says the assistant's name, or taps the
 * microphone, and talks: it answers out loud, takes them to the right screen,
 * and gets a payment ready. What shows on screen is a small capsule at the top
 * while it is listening, working out what was said or speaking, with the words
 * it hears and says; the rest of the app is the interface.
 *
 * One conversation is a loop: listen, act, speak, then listen once more for a
 * follow-up, and stop when the person goes quiet or when something has been
 * got ready for them to confirm (the next move is theirs, and the microphone
 * should be free for it). This file holds no way to confirm a payment or to
 * answer the fingerprint prompt; the screens it opens and the runner it calls
 * are the same ones the typed assistant uses.
 *
 * Waiting to be called by name is separate, optional and off until the person
 * turns it on: while it is on, and only while the app is open, the phone's
 * speech recognition listens for the name.
 */

export type Phase = 'off' | 'waiting' | 'listening' | 'thinking' | 'speaking' | 'confirming';

type Presence = {
  phase: Phase;
  /** What is being heard or said, for the capsule. Empty when there is nothing to show. */
  caption: string;
  /** Whether the app waits to be called by name. */
  wake: boolean;
  setWake: (on: boolean) => Promise<void>;
  /** Why waiting for the name stopped, said in words; `null` when all is well. */
  trouble: string | null;
  accent: Accent;
  setAccent: (id: string) => Promise<void>;
  /** This build can listen. Without it the assistant is typed to. */
  canListen: boolean;
  /** Start talking now, without the name. */
  summon: () => void;
  /** Stop listening and speaking. */
  dismiss: () => void;
};

const PresenceContext = createContext<Presence | null>(null);

/** How long it waits for the first thing said after being called, and for a follow-up after a reply. */
const FIRST_WORDS_MS = 9000;
const FOLLOW_UP_MS = 7000;
const MOST_TURNS = 8;

export function AssistantPresenceProvider({ children }: { children: React.ReactNode }) {
  const { account } = useAccount();
  const { talking } = useAssistant();
  const run = useAssistantRunner();

  const [phase, setPhase] = useState<Phase>('off');
  const [caption, setCaption] = useState('');
  const [wake, setWakeState] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [accent, setAccentState] = useState<Accent>(() => ACCENTS.find((entry) => entry.id === DEFAULT_ACCENT_ID)!);
  const [active, setActive] = useState(true);
  const [conversing, setConversing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** Bumped to make waiting start over, after the app comes back to the front or a failure. */
  const [attempt, setAttempt] = useState(0);

  const runRef = useRef(run);
  const talkingRef = useRef(talking);
  const conversation = useRef(0);
  const heard = useRef<{ stop: () => void } | null>(null);
  const greeted = useRef(0);
  const liveRef = useRef(false);
  useEffect(() => {
    runRef.current = run;
    talkingRef.current = talking;
  }, [run, talking]);

  const voiceReady = canListen();

  // What was chosen last time.
  useEffect(() => {
    let live = true;
    void Promise.all([isWakeOn(), loadAccentId()]).then(([on, id]) => {
      if (!live) return;
      setWakeState(on);
      const saved = ACCENTS.find((entry) => entry.id === id) ?? ACCENTS.find((entry) => entry.id === DEFAULT_ACCENT_ID)!;
      setVoiceAccent(saved.id);
      setAccentState(saved);
    });
    return () => {
      live = false;
    };
  }, []);

  // Listening for the name happens only while the app is in front.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setActive(state === 'active');
      if (state === 'active') setAttempt((n) => n + 1);
    });
    return () => subscription.remove();
  }, []);

  /** One thing said, as words, or `null` for silence. */
  const hear = useCallback(
    (waitMs: number, onWords: (words: string) => void) =>
      new Promise<string | null>((resolve) => {
        let settled = false;
        let guard: ReturnType<typeof setTimeout> | null = null;
        const finish = (value: string | null) => {
          if (settled) return;
          settled = true;
          if (guard) clearTimeout(guard);
          heard.current = null;
          resolve(value);
        };
        guard = setTimeout(() => {
          heard.current?.stop();
          // Stopping reports what was heard so far; if it never does, silence.
          setTimeout(() => finish(null), 900);
        }, waitMs);
        void listen({
          onWords,
          onEnd: (why, words) => finish(why === 'heard' && words ? words : null),
        }).then((handle) => {
          heard.current = handle;
          if (!handle) finish(null);
        });
      }),
    [],
  );

  const settle = useCallback(() => {
    setConversing(false);
    setCaption('');
    setPhase('off');
  }, []);

  const converse = useCallback(
    async (opening: string | null, options: { greet: boolean }) => {
      if (conversing) return;
      const mine = ++conversation.current;
      const alive = () => conversation.current === mine;
      setConversing(true);
      const history: TurnHistory = [];
      try {
        let text = opening?.trim() ? opening.trim() : null;
        for (let turn = 0; turn < MOST_TURNS && alive(); turn += 1) {
          if (!text) {
            if (turn === 0 && options.greet) {
              const line = wakeReply(greeted.current);
              greeted.current += 1;
              setPhase('speaking');
              setCaption(line);
              await speakAndWait(line);
              if (!alive()) return;
            }
            setPhase('listening');
            setCaption('');
            text = await hear(turn === 0 ? FIRST_WORDS_MS : FOLLOW_UP_MS, (words) => alive() && setCaption(words));
            if (!alive()) return;
            // Nothing said: the conversation is over, quietly.
            if (!text) break;
          }

          setCaption(text);
          setPhase('thinking');
          const outcome = await runRef.current(text, history);
          if (!alive()) return;
          history.push({ from: 'you', text }, ...(outcome.said ? [{ from: 'assistant' as const, text: outcome.said }] : []));
          text = null;

          if (outcome.said) {
            setPhase('speaking');
            setCaption(outcome.said);
            await speakAndWait(outcome.said);
            if (!alive()) return;
          }
          // Something is ready for the person to confirm. It is theirs now.
          if (outcome.prepared) break;
        }
      } catch {
        if (alive()) {
          setPhase('speaking');
          setCaption('That didn’t work. Nothing was changed.');
          await speakAndWait('That didn’t work. Nothing was changed.');
        }
      } finally {
        // Turned off or signed out part-way: nobody else will put the state back.
        if (conversation.current === mine || !liveRef.current) settle();
      }
    },
    [conversing, hear, settle],
  );

  const dismiss = useCallback(() => {
    conversation.current += 1;
    heard.current?.stop();
    heard.current = null;
    stopSpeaking();
    settle();
  }, [settle]);

  const summon = useCallback(() => {
    if (!talkingRef.current) return;
    if (conversing) {
      dismiss();
      return;
    }
    void Haptics.selectionAsync();
    void converse(null, { greet: false });
  }, [conversing, converse, dismiss]);

  // Waiting for the name.
  useEffect(() => {
    if (!voiceReady || !wake || !talking || !account || !active || conversing || confirming) return;
    let live = true;
    let handle: { stop: () => void } | null = null;
    void watchForWake({
      onWake: (rest) => {
        if (!live) return;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        void converse(rest || null, { greet: true });
      },
      onTrouble: (why) => {
        if (!live) return;
        setPhase('off');
        if (why === 'not-allowed') {
          setTrouble('The microphone is off for Entole. Turn it on in Settings to be called by name.');
          setWakeState(false);
          void saveWakeOn(false);
        } else {
          setTrouble('Listening for the name stopped. Tap the microphone to talk, or turn it on again.');
        }
      },
    }).then((started) => {
      if (!live) {
        started?.stop();
        return;
      }
      handle = started;
      if (started) {
        setTrouble(null);
        setPhase('waiting');
      }
    });
    return () => {
      live = false;
      handle?.stop();
      setPhase((current) => (current === 'waiting' ? 'off' : current));
    };
  }, [voiceReady, wake, talking, account, active, conversing, confirming, attempt, converse]);

  // The phone is about to ask for the fingerprint, face or screen lock: the
  // part that is the person's, so the assistant says so and keeps the
  // microphone to itself while they answer.
  useEffect(
    () =>
      onConfirmation(() => {
        if (!talkingRef.current || !canSpeak()) return () => undefined;
        conversation.current += 1;
        heard.current?.stop();
        heard.current = null;
        setConversing(false);
        setConfirming(true);
        setPhase('confirming');
        setCaption(CONFIRM_LINE);
        void speakAndWait(CONFIRM_LINE);
        return () => {
          setConfirming(false);
          setCaption('');
          setPhase('off');
        };
      }),
    [],
  );

  // Turned off, or signed out: nothing is listening and nothing is said.
  const live = talking && Boolean(account);
  useEffect(() => {
    liveRef.current = live;
    if (live) return;
    conversation.current += 1;
    heard.current?.stop();
    heard.current = null;
    stopSpeaking();
  }, [live]);

  const setWake = useCallback(async (on: boolean) => {
    setWakeState(on);
    setTrouble(null);
    await saveWakeOn(on);
  }, []);

  const setAccent = useCallback(async (id: string) => {
    const next = ACCENTS.find((entry) => entry.id === id) ?? ACCENTS.find((entry) => entry.id === DEFAULT_ACCENT_ID)!;
    setVoiceAccent(next.id);
    setAccentState(next);
    await saveAccentId(next.id);
  }, []);

  const value = useMemo<Presence>(
    () => ({
      phase: live ? phase : 'off',
      caption: live ? caption : '',
      wake,
      setWake,
      trouble,
      accent,
      setAccent,
      canListen: voiceReady,
      summon,
      dismiss,
    }),
    [live, phase, caption, wake, setWake, trouble, accent, setAccent, voiceReady, summon, dismiss],
  );

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function useAssistantPresence(): Presence {
  const context = useContext(PresenceContext);
  if (!context) throw new Error('useAssistantPresence must be used inside AssistantPresenceProvider');
  return context;
}
