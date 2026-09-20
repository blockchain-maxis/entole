import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import {
  USERNAME_MAX,
  normalizeUsername,
  suggestUsername,
  validateFullName,
  validateUsername,
} from '@entole/core/profile';
import { token } from '@entole/tokens';

import { Button } from '@/components/ui/Button';
import { StepDots } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';
import { storeProfile } from '@/lib/session';

/**
 * The onboarding fields that aren't money — plain text inputs are correct here,
 * not the numeric `Keypad`. Full name is what the greeting and the profile chip
 * say; the username is the handle people can find them by. The username is
 * suggested from the name until the person edits it themselves.
 *
 * Format is checked here; uniqueness is not — there is no backend to check it
 * against yet (see `@entole/core/profile`).
 */
export default function NameStep() {
  const router = useRouter();
  const { account, setAccount } = useAccount();
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [touched, setTouched] = useState(false);

  const nameError = validateFullName(fullName);
  const usernameError = validateUsername(username);
  const canContinue = !nameError && !usernameError;

  function onNameChange(next: string) {
    setFullName(next);
    if (!usernameEdited) setUsername(suggestUsername(next));
  }

  function onUsernameChange(next: string) {
    setUsernameEdited(true);
    setUsername(normalizeUsername(next));
  }

  async function submit() {
    setTouched(true);
    if (!canContinue) return;
    const profile = { fullName: fullName.trim(), username };
    await storeProfile(profile);
    if (account) setAccount({ ...account, displayName: profile.fullName, username: profile.username });
    router.push('/onboarding/phone');
  }

  return (
    <Screen>
      <View className="flex-none flex-row items-center gap-3.5 px-gutter pt-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={14}
          onPress={() => router.back()}
        >
          <Text className="font-body text-title text-slate">←</Text>
        </Pressable>
        <StepDots total={4} done={2} />
      </View>

      <View className="flex-1 px-7 pt-[34px]">
        <Text className="font-strong text-title-xl text-ink">Your details</Text>
        <Text className="mt-3 font-body text-body-sm text-slate">
          Your name is how Entole greets you. Your username is how people find you.
        </Text>

        <Text className="mt-7 font-strong text-caption text-slate">Full name</Text>
        <View className="mt-2 rounded-control border-[1.5px] border-indigo bg-card px-4 py-4">
          <TextInput
            value={fullName}
            onChangeText={onNameChange}
            placeholder="Your full name"
            placeholderTextColor={token.mist}
            autoFocus
            autoCapitalize="words"
            autoComplete="name"
            returnKeyType="next"
            accessibilityLabel="Full name"
            className="font-strong text-body-lg text-ink"
            style={{ padding: 0 }}
          />
        </View>
        {touched && nameError ? (
          <Text className="mt-2 font-body text-caption text-slate">{nameError}</Text>
        ) : null}

        <Text className="mt-5 font-strong text-caption text-slate">Username</Text>
        <View className="mt-2 flex-row items-center rounded-control border-[1.5px] border-line bg-card px-4 py-4">
          <Text className="font-strong text-body-lg text-slate">@</Text>
          <TextInput
            value={username}
            onChangeText={onUsernameChange}
            placeholder="username"
            placeholderTextColor={token.mist}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={USERNAME_MAX}
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
            accessibilityLabel="Username"
            className="ml-1 flex-1 font-strong text-body-lg text-ink"
            style={{ padding: 0 }}
          />
        </View>
        {touched && usernameError ? (
          <Text className="mt-2 font-body text-caption text-slate">{usernameError}</Text>
        ) : (
          <Text className="mt-2 font-body text-caption text-slate">
            Lowercase letters, numbers, dots and underscores.
          </Text>
        )}
      </View>

      <View className="flex-none px-gutter-lg pb-2.5 pt-3">
        <View className="flex-row">
          <Button label="Continue" disabled={!canContinue} onPress={() => void submit()} />
        </View>
      </View>
    </Screen>
  );
}
