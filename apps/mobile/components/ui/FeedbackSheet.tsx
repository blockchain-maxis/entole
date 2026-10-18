import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Linking, Pressable, ScrollView, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';

import { FEEDBACK_KINDS, FEEDBACK_MAX, FEEDBACK_MIN, type FeedbackKind } from '@entole/core/feedback';
import { token } from '@entole/tokens';

import { Button } from './Button';
import { Field } from './Field';
import { LogoLoader } from './LogoLoader';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { useProfile } from '@/lib/profile';
import { sendFeedback, type FeedbackResult } from '@/lib/support';

type Phase = 'writing' | 'sending' | 'thanks';

/** Said under the button when it did not go, in the person's terms. */
const PROBLEMS: Record<Exclude<FeedbackResult, { ok: true }>['reason'], string> = {
  not_configured: 'Feedback can’t be sent from the app just yet. You can email it to support@entole.pro instead.',
  busy: 'That’s a lot of messages at once. Wait a minute and send it again.',
  failed: 'It didn’t go through. Nothing was lost; check your connection and try again.',
};

/**
 * Send feedback. A glass sheet over whatever the person was looking at (hosted by
 * a screen with a `GlassHost`, so the glass has something to blur): pick
 * what kind of message it is, write it, and optionally leave an email to be
 * answered at. It goes to the person who builds Entole, by email, through the
 * server. When it has gone the sheet says thank you, and only then.
 */
export function FeedbackSheet({ onDismiss }: { onDismiss: () => void }) {
  const profile = useProfile();
  const [kind, setKind] = useState<FeedbackKind>('problem');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState<Phase>('writing');
  const [problem, setProblem] = useState<Exclude<FeedbackResult, { ok: true }>['reason'] | null>(null);

  const close = onDismiss;

  const ready = message.trim().length >= FEEDBACK_MIN;

  async function send() {
    if (!ready || phase !== 'writing') return;
    setPhase('sending');
    setProblem(null);
    const result = await sendFeedback({
      kind,
      message: message.trim(),
      email,
      person: profile ? { username: profile.username, name: profile.fullName } : null,
      screen: 'Me',
    });
    if (result.ok) {
      setPhase('thanks');
      return;
    }
    setProblem(result.reason);
    setPhase('writing');
  }

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1">
      <Sheet glass onDismiss={close}>
        {phase === 'thanks' ? (
          <Thanks hasEmail={email.trim().length > 0} onDone={close} />
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text accessibilityRole="header" className="font-display text-heading text-ink">
              Send feedback
            </Text>
            <Text className="mt-2 font-body text-ui text-slate">
              A person reads every message. Tell us what is working, what is not, or what you wish Entole did.
            </Text>

            <View className="mt-5 flex-row flex-wrap gap-2">
              {FEEDBACK_KINDS.map((option) => {
                const chosen = option.id === kind;
                return (
                  <Pressable
                    key={option.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: chosen }}
                    onPress={() => setKind(option.id)}
                    className={`rounded-pill border px-4 py-2.5 ${chosen ? 'border-ink bg-ink' : 'border-line bg-card/70'}`}
                  >
                    <Text className={`font-strong text-note ${chosen ? 'text-paper' : 'text-slate'}`}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View className="mt-4 rounded-control border-[1.5px] border-line bg-card/70 px-4 pb-3 pt-3.5">
              <TextInput
                value={message}
                onChangeText={(next) => {
                  setMessage(next);
                  setProblem(null);
                }}
                placeholder="What happened, or what would you like?"
                placeholderTextColor={token.mist}
                multiline
                maxLength={FEEDBACK_MAX}
                textAlignVertical="top"
                autoCapitalize="sentences"
                accessibilityLabel="Your feedback"
                className="min-h-[110px] font-body text-ui text-ink"
                style={{ padding: 0 }}
              />
              {message.length > FEEDBACK_MAX - 200 ? (
                <Text tabular className="mt-1 text-right font-body text-note text-slate">
                  {message.length} / {FEEDBACK_MAX}
                </Text>
              ) : null}
            </View>

            <View className="mt-4">
              <Field
                label="Email, if you’d like a reply"
                optional
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                maxLength={120}
              />
            </View>

            <Text className="mt-3 font-body text-note text-slate">
              We see your name and username so we can find your account. Nothing else about it.
            </Text>

            {problem ? (
              <View className="mt-3">
                <Text accessibilityRole="alert" className="font-body text-note text-halt">
                  {PROBLEMS[problem]}
                </Text>
                {problem === 'not_configured' ? (
                  <Pressable
                    accessibilityRole="link"
                    hitSlop={8}
                    onPress={() => void Linking.openURL('mailto:support@entole.pro?subject=Feedback')}
                    className="mt-1.5"
                  >
                    <Text className="font-strong text-note text-ink underline">Email support@entole.pro</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <View className="mt-5 flex-row">
              <Button
                label={phase === 'sending' ? 'Sending' : 'Send feedback'}
                busy={phase === 'sending'}
                disabled={!ready}
                onPress={() => void send()}
              />
            </View>
          </ScrollView>
        )}
      </Sheet>
    </KeyboardAvoidingView>
  );
}

/** The thank-you. The mark draws itself once and rests, complete, and then the words arrive. */
function Thanks({ hasEmail, onDone }: { hasEmail: boolean; onDone: () => void }) {
  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  return (
    <View className="items-center pb-2 pt-3">
      <LogoLoader size={84} once label="Sent" />
      <Animated.View entering={FadeInUp.delay(520).duration(320)} className="items-center">
        <Text accessibilityRole="header" className="mt-6 text-center font-display text-heading text-ink">
          Thank you for your feedback
        </Text>
      </Animated.View>
      <Animated.View entering={FadeIn.delay(760).duration(360)} className="items-center">
        <Text className="mt-2.5 text-center font-body text-ui text-slate">
          It has gone straight to the person who builds Entole.
          {hasEmail ? ' If it needs an answer, you’ll hear back by email.' : ' It helps us make this better for you.'}
        </Text>
        <View className="mt-6 w-full flex-row">
          <Button label="Done" onPress={onDone} />
        </View>
      </Animated.View>
    </View>
  );
}
