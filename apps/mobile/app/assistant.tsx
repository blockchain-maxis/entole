import * as Haptics from 'expo-haptics';
import { Redirect, useRouter } from 'expo-router';
import { Gauge, Hand, ShieldCheck, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { AssistantTag } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Header } from '@/components/ui/Header';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';
import { useAssistant } from '@/lib/assistant';
import { useAssistantHeard, useAssistantPresence } from '@/lib/assistant-presence';
import { useThemeColors } from '@/lib/theme';
import { ASK_UNDO_SECONDS, proposeFromRequest } from '@entole/core/assistant-ask';
import { ACCENTS, ASSISTANT_NAME } from '@entole/core/assistant-persona';
import { useBackend } from '@entole/core/backend';
import { useStore } from '@entole/core/store';

const POINTS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Gauge,
    title: 'It only spends what you allow',
    body: 'Each thing it can do is an allowance: an amount, how often it resets, and a balance that only goes down as it is used. When the balance is gone, it stops.',
  },
  {
    icon: Hand,
    title: 'You can stop it in one tap',
    body: 'The Assistant chip at the top of every screen pauses it right away. Your allowances stay exactly as they are.',
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
 * the person writes one. Signing in never asks for it. Mirrors
 * `apps/web/app/assistant/page.tsx`.
 */
export default function AssistantSettings() {
  const router = useRouter();
  const store = useStore();
  const assistant = useAssistant();
  const presence = useAssistantPresence();
  const colors = useThemeColors();
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { account } = useAccount();

  async function letItPay() {
    setWorking(true);
    setProblem(null);
    try {
      const result = await assistant.enable();
      if (result.ok) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setProblem(result.reason);
      }
    } finally {
      setWorking(false);
    }
  }

  async function stopPaying() {
    setWorking(true);
    setProblem(null);
    try {
      await assistant.disable();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } finally {
      setWorking(false);
    }
  }

  // The assistant belongs to an account. With nobody signed in there is
  // nothing to turn on, so this screen sends them to the start instead.
  if (!account) return <Redirect href="/" />;

  const anyOn = assistant.talking || assistant.enabled;
  const hasAllowances = store.allowances.length > 0;

  return (
    <Screen keyboard>
      <Header title="Assistant" />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="font-display text-subhead text-ink">
          {anyOn ? `Your assistant, ${ASSISTANT_NAME}` : `${ASSISTANT_NAME}, an assistant that works the app for you`}
        </Text>
        <Text className="mt-2.5 font-body text-ui text-slate">
          Talk to {ASSISTANT_NAME} like a person. Ask for your balance and it takes you there and tells you. Say you
          want to send money and it opens Send. Anything that moves your money, you confirm yourself, unless it is
          inside an allowance you wrote.
        </Text>

        <View className="mt-6 border-t border-hairline">
          <View className="border-b border-hairline py-4">
            <View className="flex-row items-baseline justify-between gap-4">
              <Text className="font-strong text-ui text-ink">Talks with you</Text>
              <AssistantTag>{assistant.talking ? 'On' : 'Off'}</AssistantTag>
            </View>
            <Text className="mt-1 font-body text-note text-slate">
              {assistant.talking
                ? `Tap the microphone at the top of any screen and talk. Hold it to type instead.`
                : 'Turning this on asks for nothing. It cannot move money by talking.'}
            </Text>
            <View className="mt-3 flex-row">
              <Button
                label={assistant.talking ? 'Stop talking' : 'Start talking'}
                variant={assistant.talking ? 'secondary' : 'primary'}
                width="hug"
                disabled={assistant.loading}
                onPress={() =>
                  void (assistant.talking
                    ? assistant.stopTalking()
                    : assistant.startTalking().then(() => presence.greet('talking-on')))
                }
              />
            </View>
          </View>

          {assistant.talking ? (
            <>
              <View className="border-b border-hairline py-4">
                <View className="flex-row items-baseline justify-between gap-4">
                  <Text className="font-strong text-ui text-ink">Say “Hey {ASSISTANT_NAME}”</Text>
                  <AssistantTag>{presence.wake ? 'On' : 'Off'}</AssistantTag>
                </View>
                <Text className="mt-1 font-body text-note text-slate">
                  {presence.canListen
                    ? `While Entole is open, your phone’s speech service listens for ${ASSISTANT_NAME}’s name, and a small dot shows at the top. Nothing is kept, and it stops when you leave the app.`
                    : 'This version of the app cannot listen yet, so use the microphone or type.'}
                </Text>
                {presence.trouble ? <Text className="mt-1.5 font-body text-note text-halt">{presence.trouble}</Text> : null}
                {presence.canListen ? (
                  <View className="mt-3 flex-row">
                    <Button
                      label={presence.wake ? 'Stop listening for the name' : `Listen for “Hey ${ASSISTANT_NAME}”`}
                      variant={presence.wake ? 'secondary' : 'primary'}
                      width="hug"
                      onPress={() => void presence.setWake(!presence.wake)}
                    />
                  </View>
                ) : null}
                {presence.wake && presence.canListen ? <HeardLine /> : null}
              </View>

              <View className="border-b border-hairline py-4">
                <Text className="font-strong text-ui text-ink">Voice</Text>
                <Text className="mt-1 font-body text-note text-slate">
                  How {ASSISTANT_NAME} sounds, and the English it listens for.
                </Text>
                <View className="mt-3 flex-row flex-wrap gap-2">
                  {ACCENTS.map((accent) => {
                    const chosen = accent.id === presence.accent.id;
                    return (
                      <Pressable
                        key={accent.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected: chosen }}
                        onPress={() => void presence.setAccent(accent.id)}
                        className={`rounded-control border px-4 py-2.5 ${chosen ? 'border-ink bg-ink' : 'border-line bg-card'}`}
                      >
                        <Text className={`font-strong text-note ${chosen ? 'text-paper' : 'text-slate'}`}>{accent.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              {presence.canListen ? (
                <View className="border-b border-hairline py-4">
                  <View className="flex-row items-baseline justify-between gap-4">
                    <Text className="font-strong text-ui text-ink">Hear me while {ASSISTANT_NAME} talks</Text>
                    <AssistantTag>{presence.interrupt ? 'On' : 'Off'}</AssistantTag>
                  </View>
                  <Text className="mt-1 font-body text-note text-slate">
                    {presence.interrupt
                      ? `The microphone stays on while ${ASSISTANT_NAME} speaks, so you can cut in by saying “stop”, “wait” or ${ASSISTANT_NAME}’s name, or by talking over it. It works best with headphones: on a speaker, the microphone can hear ${ASSISTANT_NAME}’s own voice.`
                      : `The microphone ignores everything while ${ASSISTANT_NAME} speaks, so it can never hear itself. You wait for it to finish.`}
                  </Text>
                  <View className="mt-3 flex-row">
                    <Button
                      label={presence.interrupt ? 'Turn off' : 'Turn on'}
                      variant="secondary"
                      width="hug"
                      onPress={() => void presence.setInterrupt(!presence.interrupt)}
                    />
                  </View>
                </View>
              ) : null}
            </>
          ) : null}

          <View className="border-b border-hairline py-4">
            <View className="flex-row items-baseline justify-between gap-4">
              <Text className="font-strong text-ui text-ink">Pays inside allowances</Text>
              <AssistantTag>{assistant.enabled ? 'On' : 'Off'}</AssistantTag>
            </View>
            <Text className="mt-1 font-body text-note text-slate">
              {assistant.enabled
                ? `It pays only inside the allowances you write, and each payment waits ${ASK_UNDO_SECONDS} seconds for you to stop it.`
                : hasAllowances
                  ? 'Your allowances are there. Let it pay inside them; that asks you to confirm with your passkey once more.'
                  : 'Write it an allowance and it can pay inside it, never past it. Your first one asks you to confirm with your passkey once more.'}
            </Text>
            <View className="mt-3 flex-row">
              {assistant.enabled ? (
                <Button
                  label={working ? 'Working' : 'Stop it paying'}
                  variant="secondary"
                  width="hug"
                  busy={working}
                  onPress={() => void stopPaying()}
                />
              ) : hasAllowances ? (
                <Button
                  label={working ? 'Confirming' : 'Let it pay inside them'}
                  width="hug"
                  busy={working}
                  disabled={assistant.loading}
                  onPress={() => void letItPay()}
                />
              ) : (
                <Button label="Write an allowance" width="hug" onPress={() => router.push('/rules/new')} />
              )}
            </View>
          </View>
        </View>

        {problem ? <Text className="mt-4 font-body text-note text-halt">{problem}</Text> : null}

        {assistant.enabled ? <AskAssistant /> : null}

        <View className="mt-7 gap-5">
          {POINTS.map((point) => (
            <View key={point.title} className="flex-row gap-3.5">
              <View className="h-10 w-10 items-center justify-center rounded-control bg-indigo-wash">
                <point.icon size={20} strokeWidth={1.75} color={colors.indigo.DEFAULT} />
              </View>
              <View className="flex-1">
                <Text className="font-strong text-ui text-ink">{point.title}</Text>
                <Text className="mt-1 font-body text-ui text-slate">{point.body}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {anyOn ? (
        <ActionBar>
          <Button label="Done" variant="secondary" onPress={() => router.replace('/(tabs)')} />
        </ActionBar>
      ) : null}
    </Screen>
  );
}

/**
 * Asking the assistant to pay someone. A sentence becomes a proposal, and the
 * proposal runs the same undo window as any other: this never sends anything
 * itself. Whether the payment may happen is the allowance's decision, made
 * when the assistant tries to run it. The phone twin of the form on the web
 * assistant page.
 */
function AskAssistant() {
  const router = useRouter();
  const store = useStore();
  const { proposals } = useBackend();
  const [text, setText] = useState('');
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function ask() {
    if (working || text.trim().length === 0) return;
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
      router.push('/assistant-action');
    } catch {
      proposals.clear();
      setProblem("We couldn't start that. Nothing was sent. Try again.");
    } finally {
      setWorking(false);
    }
  }

  if (store.status !== 'ready') return null;

  if (store.allowances.length === 0) {
    return (
      <View className="mt-6 rounded-card bg-indigo-wash p-5">
        <Text className="font-strong text-ui text-ink">Nothing for it to do yet</Text>
        <Text className="mt-1 font-body text-ui text-slate">
          Set an allowance for someone and you can ask the assistant to pay them.
        </Text>
        <View className="mt-3 flex-row">
          <Button label="Set up an allowance" variant="secondary" width="hug" onPress={() => router.push('/rules/new')} />
        </View>
      </View>
    );
  }

  return (
    <View className="mt-6 rounded-card bg-indigo-wash p-5">
      <Field
        label="Ask it to pay someone"
        value={text}
        onChangeText={(next) => {
          setText(next);
          setProblem(null);
        }}
        placeholder="Pay 5000 to Ada for rent"
        autoCapitalize="sentences"
        autoCorrect={false}
        returnKeyType="send"
        onSubmitEditing={() => void ask()}
        hint={`Say who and how much. You get ${ASK_UNDO_SECONDS} seconds to stop it before it is sent.`}
        error={problem}
      />
      <View className="mt-4 flex-row">
        <Button
          label={working ? 'Starting' : 'Ask the assistant'}
          busy={working}
          disabled={text.trim().length === 0}
          onPress={() => void ask()}
        />
      </View>
    </View>
  );
}

/**
 * What the microphone is hearing, live, while "Hey Ayo" is on: so a person can
 * see that it hears them and what it makes of the name, and so a problem can be
 * told apart: nothing shown means the microphone is not delivering anything,
 * words shown that are not the name mean the name is being misheard.
 */
function HeardLine() {
  const heard = useAssistantHeard();
  const { phase } = useAssistantPresence();
  const open = phase !== 'off';
  return (
    <View className="mt-3 rounded-control border border-line bg-card px-3.5 py-3">
      <Text className="font-strong text-note text-slate">{open ? 'The microphone is open. It hears:' : 'The microphone is not open yet'}</Text>
      <Text numberOfLines={3} className="mt-1 font-body text-ui text-ink">
        {heard ? `“${heard}”` : open ? `Nothing yet. Say “Hey ${ASSISTANT_NAME}”.` : 'Open the app’s settings to check the microphone.'}
      </Text>
    </View>
  );
}
