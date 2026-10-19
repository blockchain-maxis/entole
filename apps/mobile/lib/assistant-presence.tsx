import * as Haptics from 'expo-haptics';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { ACCENTS, CONFIRM_LINE, DEFAULT_ACCENT_ID, welcomeLine, type Accent } from '@entole/core/assistant-persona';
import { greetingFor } from '@entole/core/format';
import { recognitionVocabulary } from '@entole/core/nigerian-names';
import { useStore } from '@entole/core/store';

import { useAccount } from './account';
import { useAssistant } from './assistant';
import { useAssistantRunner } from './assistant-run';
import { onConfirmation } from './confirm-announce';
import type { Phase } from './conversation';
import { presence } from './presence-engine';
import { isInterruptOn, isWakeOn, loadAccentId, saveAccentId, saveInterruptOn, saveWakeOn } from './session';
import { canListen, canSpeak, setVoiceAccent } from './voice';

export type { Phase };

/**
 * The assistant as a presence, not a screen.
 *
 * There is no chat to open. The person says the assistant's name, or taps the
 * microphone, and talks: it answers out loud, takes them to the right screen,
 * and gets a payment ready. What shows is a small capsule at the top while it
 * listens, works or speaks, with the words it hears and says.
 *
 * This file is the glue. The conversation itself (when a sentence is finished,
 * what is its own voice coming back, someone talking over it) is
 * `lib/conversation.ts`; the microphone that stays open is `openEars` in
 * `lib/voice.ts`. Both are tested without a phone. Here they are given a screen,
 * a voice and the runner the typed assistant uses, and nothing else: no way to
 * confirm a payment, and none to answer the fingerprint prompt.
 *
 * Waiting to be called by name is optional and off until the person turns it
 * on. While it is on, and only while the app is open, one microphone session is
 * kept open and searched for the name. A dot shows for as long as it is open.
 */

type Presence = {
  phase: Phase;
  /** Whether the app waits to be called by name. */
  wake: boolean;
  setWake: (on: boolean) => Promise<void>;
  /** Whether it can be talked over while it speaks. Off, the microphone is ignored until it has finished. */
  interrupt: boolean;
  setInterrupt: (on: boolean) => Promise<void>;
  /** Why listening stopped, said in words; `null` when all is well. */
  trouble: string | null;
  accent: Accent;
  setAccent: (id: string) => Promise<void>;
  /** This build can listen. Without it the assistant is typed to. */
  canListen: boolean;
  /** Start talking now, without the name. */
  summon: () => void;
  /** Welcomes the person by name, as if it had just arrived. For when they have just turned it on. */
  greet: (kind: 'turned-on' | 'talking-on') => void;
  /** Stop listening and speaking. */
  dismiss: () => void;
};

const PresenceContext = createContext<Presence | null>(null);
/** The words on the capsule. They change with every word heard, so they have a context of their own and the rest of the app does not re-render with them. */
const CaptionContext = createContext<string>('');
/** What the microphone hears right now. Only filled while a screen asks to see it. */
const HeardContext = createContext<string>('');

const MIC_OFF = 'The microphone is off for Entole. Turn it on in Settings to talk to Ayo, or hold the microphone to type.';
const COULD_NOT_LISTEN = 'Listening stopped. Tap the microphone to talk, or turn on “Hey Ayo” again.';

export function AssistantPresenceProvider({ children }: { children: React.ReactNode }) {
  const { account } = useAccount();
  const { talking } = useAssistant();
  const run = useAssistantRunner();
  const store = useStore();
  const signedIn = Boolean(account);

  const [conversationPhase, setConversationPhase] = useState<Phase>('off');
  const [caption, setCaption] = useState('');
  const [wake, setWakeState] = useState(false);
  const [interrupt, setInterruptState] = useState(true);
  const [heard, setHeard] = useState('');
  const [trouble, setTrouble] = useState<string | null>(null);
  const [accent, setAccentState] = useState<Accent>(() => ACCENTS.find((entry) => entry.id === DEFAULT_ACCENT_ID)!);
  const [active, setActive] = useState(true);
  const [earsOpen, setEarsOpen] = useState(false);

  const talkingRef = useRef(talking);
  const firstNameRef = useRef<string | null>(null);
  const firstName = account?.displayName?.trim().split(/\s+/)[0] || null;
  useEffect(() => {
    talkingRef.current = talking;
    firstNameRef.current = firstName;
  }, [talking, firstName]);

  const voiceReady = canListen();

  // The engine shows things through these, and carries out requests with the runner.
  useEffect(() => {
    presence.bind({
      setPhase: setConversationPhase,
      setCaption,
      setEarsOpen,
      setHeard,
      onTrouble: (why) => {
        if (why === 'not-allowed') {
          setTrouble(MIC_OFF);
          setWakeState(false);
          void saveWakeOn(false);
        } else {
          setTrouble(COULD_NOT_LISTEN);
        }
      },
    });
  }, []);
  useEffect(() => {
    presence.setRunner(run);
  }, [run]);
  // The people the person has saved, and common Nigerian names, are what the microphone leans towards.
  const contacts = store.contacts;
  useEffect(() => {
    presence.setVocabulary(recognitionVocabulary(contacts));
  }, [contacts]);
  useEffect(() => {
    presence.setWaiting(wake);
  }, [wake]);
  useEffect(() => {
    presence.setInterruptible(interrupt);
  }, [interrupt]);

  // What was chosen last time.
  useEffect(() => {
    let live = true;
    void Promise.all([isWakeOn(), loadAccentId(), isInterruptOn()]).then(([on, id, canInterrupt]) => {
      if (!live) return;
      setWakeState(on);
      setInterruptState(canInterrupt);
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
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  // Waiting for the name: one microphone session, opened when it is wanted and
  // kept until it is not. It does not restart as the conversation moves on.
  const live = voiceReady && talking && signedIn && active;
  useEffect(() => {
    presence.setEnabled(live);
  }, [live]);
  useEffect(() => {
    if (!live || !wake) return;
    // Open, and say hello once per run of the app: someone arriving, not a setting changing.
    void presence.ensureEars().then((open) => {
      if (open) presence.greetOnce(welcomeLine('launch', firstNameRef.current, greetingFor()));
    });
    return () => presence.shutDown();
  }, [live, wake]);

  // Turned off, signed out, or the app put away: nothing is listening and nothing is said.
  useEffect(() => {
    if (!live) presence.shutDown();
  }, [live]);

  // The phone is about to ask for the fingerprint, face or screen lock: the part
  // that is the person's, so the assistant says so. The microphone stays on.
  useEffect(
    () =>
      onConfirmation(() => {
        if (!talkingRef.current || !canSpeak()) return () => undefined;
        void presence.conversation.announce(CONFIRM_LINE, () => undefined);
        return () => undefined;
      }),
    [],
  );

  const greet = useCallback((kind: 'turned-on' | 'talking-on') => {
    void presence.conversation.tell(welcomeLine(kind, firstNameRef.current, greetingFor()));
  }, []);

  const setWake = useCallback(
    async (on: boolean) => {
      setWakeState(on);
      setTrouble(null);
      await saveWakeOn(on);
      // Just turned on: it opens the microphone and introduces itself.
      if (on && talkingRef.current && (await presence.ensureEars())) greet('turned-on');
    },
    [greet],
  );

  const setInterrupt = useCallback(async (on: boolean) => {
    setInterruptState(on);
    await saveInterruptOn(on);
  }, []);

  const setAccent = useCallback(async (id: string) => {
    const next = ACCENTS.find((entry) => entry.id === id) ?? ACCENTS.find((entry) => entry.id === DEFAULT_ACCENT_ID)!;
    setVoiceAccent(next.id);
    setAccentState(next);
    await saveAccentId(next.id);
  }, []);

  const summon = useCallback(() => {
    if (!talkingRef.current) return;
    void Haptics.selectionAsync();
    void presence.conversation.summon();
  }, []);

  const dismiss = useCallback(() => presence.conversation.dismiss(), []);

  // Waiting is shown while the microphone is open for the name and nothing else is going on.
  const phase: Phase = !live ? 'off' : conversationPhase !== 'off' ? conversationPhase : earsOpen && wake ? 'waiting' : 'off';

  const value = useMemo<Presence>(
    () => ({ phase, wake, setWake, interrupt, setInterrupt, trouble, accent, setAccent, canListen: voiceReady, summon, greet, dismiss }),
    [phase, wake, setWake, interrupt, setInterrupt, trouble, accent, setAccent, voiceReady, summon, greet, dismiss],
  );

  return (
    <PresenceContext.Provider value={value}>
      <CaptionContext.Provider value={live ? caption : ''}>
        <HeardContext.Provider value={live ? heard : ''}>{children}</HeardContext.Provider>
      </CaptionContext.Provider>
    </PresenceContext.Provider>
  );
}

export function useAssistantPresence(): Presence {
  const context = useContext(PresenceContext);
  if (!context) throw new Error('useAssistantPresence must be used inside AssistantPresenceProvider');
  return context;
}

/** The words the capsule shows: what is being heard, or said. */
export function useAssistantCaption(): string {
  return useContext(CaptionContext);
}

/**
 * What the microphone is hearing right now, as the recogniser writes it, for
 * the assistant's settings: so a person can see that it hears them, and what it
 * makes of "Hey Ayo". It costs nothing while no screen is asking.
 */
export function useAssistantHeard(): string {
  useEffect(() => {
    presence.watch(true);
    return () => presence.watch(false);
  }, []);
  return useContext(HeardContext);
}
