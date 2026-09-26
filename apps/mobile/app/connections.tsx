import * as Clipboard from 'expo-clipboard';
import { getRandomValues } from 'expo-crypto';
import { Check, Copy } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { useBackend } from '@entole/core/backend';
import { useStore } from '@entole/core/store';

import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useThemeColors } from '@/lib/theme';

/**
 * Connect a Telegram chat to this account, so a message like "send mom 5k for
 * rent" becomes a proposal that lands in the app and runs the same undo window
 * before anything settles. Linking shares the account's people and their
 * allowances with the assistant so it can match who a message means; it grants
 * no new spending power, and the assistant still cannot move money outside an
 * allowance you already set.
 */

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function makeCode(): string {
  const bytes = getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

const STEPS: { title: string; body: string }[] = [
  { title: 'Create a link code', body: 'Get a one-time code for this account with the button below.' },
  { title: 'Message the Entole bot', body: 'Open Telegram, find the Entole bot, and start a chat with it.' },
  { title: 'Send the code', body: 'Send the bot the line below to tie that chat to your account.' },
];

export default function Connections() {
  const store = useStore();
  const { inbox } = useBackend();
  const colors = useThemeColors();
  const [code, setCode] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const activeAllowance =
    store.allowances.find((a) => !a.paused && a.remainingMinor > 0) ?? store.allowances[0];

  async function createCode() {
    setWorking(true);
    setProblem(null);
    setCopied(false);
    const next = makeCode();
    const registered = await inbox.registerLinkCode(next);
    if (!registered) {
      setProblem('Could not create a link code just now. Try again in a moment.');
      setWorking(false);
      return;
    }
    // Share the account's people and active allowance so the bot matches names
    // and charges a real allowance rather than reading an empty book.
    if (activeAllowance) await inbox.sync(store.contacts, activeAllowance.id);
    setCode(next);
    setWorking(false);
  }

  async function copyCode() {
    if (!code) return;
    await Clipboard.setStringAsync(`/link ${code}`);
    setCopied(true);
  }

  return (
    <Screen>
      <Header title="Connections" />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="font-strong text-headline text-ink">Ask the assistant by message</Text>
        <Text className="mt-2.5 font-body text-body-sm text-slate">
          Connect Telegram and you can message the assistant to pay someone. Every request still
          appears here and waits out its undo window before it settles.
        </Text>

        <View className="mt-7 gap-5">
          {STEPS.map((step, index) => (
            <View key={step.title} className="flex-row gap-3.5">
              <View className="h-10 w-10 items-center justify-center rounded-control bg-indigo-wash">
                <Text className="font-strong text-body text-indigo">{index + 1}</Text>
              </View>
              <View className="flex-1">
                <Text className="font-strong text-body text-ink">{step.title}</Text>
                <Text className="mt-1 font-body text-body-sm text-slate">{step.body}</Text>
              </View>
            </View>
          ))}
        </View>

        {code ? (
          <View className="mt-7 gap-2 rounded-row border border-line bg-card p-4">
            <Text className="font-body text-label-sm text-slate">Send this to the bot</Text>
            <View className="flex-row items-center justify-between gap-3">
              <Text tabular className="font-strong text-title text-ink">
                /link {code}
              </Text>
              <Pressable
                onPress={() => void copyCode()}
                className="h-10 flex-row items-center gap-1.5 rounded-control border border-line bg-card px-3"
              >
                {copied ? (
                  <Check size={16} strokeWidth={1.75} color={colors.ink} />
                ) : (
                  <Copy size={16} strokeWidth={1.75} color={colors.ink} />
                )}
                <Text className="font-strong text-label-sm text-ink">{copied ? 'Copied' : 'Copy'}</Text>
              </Pressable>
            </View>
            <Text className="mt-1 font-body text-label-sm text-mist">
              The code works once and expires after it is used.
            </Text>
          </View>
        ) : null}

        {!activeAllowance ? (
          <Text className="mt-6 font-body text-label-sm text-mist">
            Set up an allowance first, or the assistant will have nothing it is allowed to spend.
          </Text>
        ) : null}
        {problem ? <Text className="mt-4 font-body text-label-sm text-halt">{problem}</Text> : null}
      </ScrollView>

      <ActionBar>
        <Button
          label={working ? 'Creating' : code ? 'Create a new code' : 'Create a link code'}
          busy={working}
          disabled={store.status === 'loading'}
          onPress={() => void createCode()}
        />
      </ActionBar>
    </Screen>
  );
}
