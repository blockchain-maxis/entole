import * as Haptics from 'expo-haptics';
import { Redirect, useRouter } from 'expo-router';
import { ArrowUp, Mic, Square } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, TextInput, View } from 'react-native';

import type { TurnHistory } from '@entole/core/assistant-brain';
import { token } from '@entole/tokens';

import { LogoLoader } from '@/components/ui/LogoLoader';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';
import { useAssistant } from '@/lib/assistant';
import { useAssistantRunner } from '@/lib/assistant-run';
import { useThemeColors } from '@/lib/theme';
import { useToast } from '@/lib/toast';
import { canListen, listen, speak, stopSpeaking } from '@/lib/voice';

type Turn = { from: 'you' | 'assistant'; text: string };
type Phase = 'idle' | 'listening' | 'reading';

const EXAMPLES = ['Send 5,000 to Mum for rent', 'What’s my balance?', 'Show how I get paid'];

/**
 * Talking to the assistant. Say what you need, or type it. Your words are in
 * ink; what the assistant says back is in its own blue, set the way an
 * allowance is written.
 *
 * It works the app for you: it opens the screen, picks the person, fills in the
 * amount, and then this sheet is gone and you are looking at what it did.
 * Confirming is yours. Nothing here can press Confirm or answer the
 * fingerprint prompt.
 *
 * Listening and speaking need a build of the app that has them. On one that
 * does not, the assistant is typed to and what it says is read, not heard.
 */
export default function Talk() {
  const router = useRouter();
  const { account } = useAccount();
  const { enabled } = useAssistant();
  const run = useAssistantRunner();
  const { show } = useToast();
  const colors = useThemeColors();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [typed, setTyped] = useState('');
  const [hearing, setHearing] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const session = useRef<{ stop: () => void } | null>(null);
  const live = useRef(true);
  const turnsRef = useRef<Turn[]>([]);
  const scroller = useRef<ScrollView>(null);
  const hears = canListen();

  useEffect(
    () => () => {
      live.current = false;
      session.current?.stop();
    },
    [],
  );

  // Off means off: the sheet does not exist for someone who has not turned the assistant on.
  if (!account || !enabled) return <Redirect href="/" />;

  const note = (turn: Turn) => {
    turnsRef.current = [...turnsRef.current, turn].slice(-8);
    if (live.current) setTurns(turnsRef.current);
  };

  async function ask(spoken: string) {
    const text = spoken.replace(/\s+/g, ' ').trim();
    if (!text || phase === 'reading') return;
    stopSpeaking();
    setProblem(null);
    setHearing('');
    const history: TurnHistory = turnsRef.current.slice(-6);
    note({ from: 'you', text });
    setPhase('reading');
    try {
      const outcome = await run(text, history);
      if (outcome.said) speak(outcome.said);
      if (outcome.moved) {
        // The sheet has been put away for what it opened. What it said goes with the person.
        if (outcome.said) show(outcome.said, 'assistant');
        return;
      }
      if (outcome.said) note({ from: 'assistant', text: outcome.said });
    } catch {
      note({ from: 'assistant', text: "That didn't work. Nothing was changed. Try again." });
    } finally {
      if (live.current) setPhase('idle');
    }
  }

  async function startListening() {
    if (session.current || phase !== 'idle') return;
    stopSpeaking();
    setProblem(null);
    setHearing('');
    setPhase('listening');
    void Haptics.selectionAsync();
    const started = await listen({
      onWords: (words) => live.current && setHearing(words),
      onEnd: (why, words) => {
        session.current = null;
        if (!live.current) return;
        if (why === 'heard' && words) {
          setPhase('idle');
          void ask(words);
          return;
        }
        setPhase('idle');
        setHearing('');
        setProblem(
          why === 'not-allowed'
            ? 'The microphone is off for Entole. Turn it on in Settings, or type instead.'
            : why === 'failed'
              ? "I couldn't listen just now. Try again, or type instead."
              : "I didn't hear anything. Tap the microphone and try again.",
        );
      },
    });
    session.current = started;
  }

  function close() {
    session.current?.stop();
    stopSpeaking();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }

  function submit() {
    const text = typed.trim();
    if (!text) return;
    setTyped('');
    void ask(text);
  }

  const listening = phase === 'listening';
  const reading = phase === 'reading';

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1">
      <Sheet onDismiss={close}>
        <Text className="font-strong text-note text-indigo">The assistant</Text>

        <ScrollView
          ref={scroller}
          className="mt-2 max-h-[280px]"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
        >
          {turns.length === 0 && !hearing ? (
            <View>
              <Text accessibilityRole="header" className="font-display text-heading text-ink">
                What do you need?
              </Text>
              <View className="mt-3 border-t border-hairline">
                {EXAMPLES.map((example) => (
                  <Pressable
                    key={example}
                    accessibilityRole="button"
                    disabled={reading}
                    onPress={() => void ask(example)}
                    className="border-b border-hairline py-3 active:bg-press"
                  >
                    <Text className="font-body text-ui text-slate">“{example}”</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            <View className="gap-3 pb-1">
              {turns.slice(-6).map((turn, index) =>
                turn.from === 'you' ? (
                  <Text key={index} className="font-body text-ui text-ink">
                    {turn.text}
                  </Text>
                ) : (
                  <Text key={index} className="font-display-plain text-subhead text-indigo">
                    {turn.text}
                  </Text>
                ),
              )}
              {hearing ? <Text className="font-body text-ui text-slate">{hearing}</Text> : null}
            </View>
          )}
        </ScrollView>

        {problem ? <Text className="mt-2 font-body text-note text-halt">{problem}</Text> : null}

        <View className="mt-4 flex-row items-center gap-3">
          {hears ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={listening ? 'Stop listening' : 'Start talking'}
              accessibilityState={{ selected: listening, disabled: reading }}
              disabled={reading}
              onPress={() => (listening ? session.current?.stop() : void startListening())}
              className="h-14 w-14 flex-none items-center justify-center rounded-pill bg-indigo active:scale-95"
            >
              {reading ? (
                <LogoLoader size={26} label="Working it out" color={colors.paper} />
              ) : listening ? (
                <Square size={18} strokeWidth={0} color={colors.paper} fill={colors.paper} />
              ) : (
                <Mic size={22} strokeWidth={1.9} color={colors.paper} />
              )}
            </Pressable>
          ) : null}

          <View className="min-w-0 flex-1 flex-row items-center rounded-control border-[1.5px] border-line bg-paper pl-4 pr-1.5">
            <TextInput
              value={typed}
              onChangeText={setTyped}
              placeholder={listening ? 'Listening' : hears ? 'Or type it' : 'Type what you need'}
              placeholderTextColor={token.mist}
              autoCapitalize="sentences"
              returnKeyType="send"
              maxLength={300}
              editable={!listening}
              onSubmitEditing={submit}
              accessibilityLabel="Type what you need"
              className="h-12 min-w-0 flex-1 font-body text-ui text-ink"
              style={{ padding: 0 }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send to the assistant"
              disabled={!typed.trim() || reading}
              onPress={submit}
              className={`h-9 w-9 flex-none items-center justify-center rounded-pill bg-ink ${
                !typed.trim() || reading ? 'opacity-30' : ''
              }`}
            >
              {reading && !hears ? (
                <LogoLoader size={18} label="Working it out" color={colors.paper} />
              ) : (
                <ArrowUp size={18} strokeWidth={2} color={colors.paper} />
              )}
            </Pressable>
          </View>
        </View>

        <Text className="mt-3 font-body text-note text-slate">
          It opens screens and gets things ready. Anything that moves your money, you confirm yourself.
          {hears ? '' : ' This version of the app cannot listen yet, so type what you need.'}
        </Text>
      </Sheet>
    </KeyboardAvoidingView>
  );
}
