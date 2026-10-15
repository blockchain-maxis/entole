import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { useBackend } from '@entole/core/backend';
import { DirectoryError } from '@entole/core/directory';
import {
  USERNAME_MAX,
  initialsFor,
  normalizeUsername,
  suggestUsername,
  validateFullName,
  validateUsername,
} from '@entole/core/profile';
import { USERNAME_TAKEN, useUsernameCheck } from '@entole/core/username-check';
import { token } from '@entole/tokens';

import { Button } from '@/components/ui/Button';
import { StepDots } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';
import { API_BASE } from '@/lib/onchain';
import { markOnboarded, recordUsernameClaim, registerAccount, storeProfile } from '@/lib/session';

/**
 * The onboarding fields that aren't money — plain text inputs are correct here,
 * not the numeric `Keypad`. Full name is what the greeting and the profile chip
 * say; the username is the handle people can find them by. The username is
 * suggested from the name until the person edits it themselves.
 *
 * A username is one person's. The field says so as it is typed, and
 * continuing claims it for this account: if someone else got there first, the
 * claim is refused and the person picks another before going on.
 *
 * A new person comes here before they have an account: Continue makes their
 * passkey, saved under the username and name just typed, so a phone holding
 * several passkeys can tell this one apart. Then the username is claimed for
 * the account the passkey made.
 *
 * Someone who signed in with a passkey from another device lands here too
 * (`returning`): their account exists, this phone just has no name for them.
 * They are asked once and go straight in, past the steps a new person takes.
 */
export default function NameStep() {
  const router = useRouter();
  const returning = useLocalSearchParams<{ returning?: string }>().returning === '1';
  const usernameField = useRef<TextInput>(null);
  const { account, setAccount } = useAccount();
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** A name the directory refused when it was claimed: someone took it in between. */
  const [refused, setRefused] = useState<string | null>(null);
  const backend = useBackend();

  const check = useUsernameCheck(API_BASE, username, account?.owner.address);
  const taken = check === 'taken' || refused === username;
  const nameError = validateFullName(fullName);
  const usernameError = validateUsername(username) ?? (taken ? USERNAME_TAKEN : null);
  const canContinue = !nameError && !usernameError && check !== 'checking' && !saving;

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
    setProblem(null);
    let current = account;
    if (!current) {
      setSaving(true);
      const made = await registerAccount(profile);
      if (!made.ok) {
        setProblem(made.reason);
        setSaving(false);
        return;
      }
      current = made.account;
      setAccount(made.account);
    }
    if (current) {
      setSaving(true);
      try {
        await backend.directory.claim({
          address: current.owner.address,
          name: profile.fullName,
          initials: initialsFor(profile.fullName),
          tone: 1,
          username,
        });
        await recordUsernameClaim(current.owner.address, username);
      } catch (error) {
        // Taken in the moment between the check and the claim: stay and pick
        // another. Anything else (no connection, say) does not block signing
        // up; the claim is made again once the app is open.
        if (error instanceof DirectoryError && error.code === 'username_taken') {
          setRefused(username);
          setSaving(false);
          return;
        }
      }
      setSaving(false);
    }
    await storeProfile(profile);
    if (current) setAccount({ ...current, displayName: profile.fullName, username: profile.username });
    if (returning) {
      await markOnboarded();
      router.replace('/(tabs)');
      return;
    }
    router.push('/onboarding/phone');
  }

  return (
    <Screen keyboard>
      <View className="flex-none flex-row items-center gap-3.5 px-gutter pt-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={14}
          onPress={() => router.back()}
        >
          <Text className="font-body text-subhead text-slate">←</Text>
        </Pressable>
        {returning ? null : <StepDots total={4} done={2} />}
      </View>

      {/* Scrolls, so on a short phone with the keyboard up both fields can
          still be reached; Continue stays pinned above the keyboard. */}
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 28, paddingTop: 34, paddingBottom: 16 }}
      >
        <Text className="font-display text-heading text-ink">{returning ? 'Welcome back' : 'Your details'}</Text>
        <Text className="mt-3 font-body text-ui text-slate">
          {returning
            ? 'Your account and your money are already here. This phone just does not know your name yet.'
            : 'Your name is how Entole greets you. Your username is how people find you.'}
        </Text>

        <Text className="mt-7 font-strong text-note text-slate">Full name</Text>
        <View className="mt-2 rounded-control border-[1.5px] border-ink bg-card px-4 py-4">
          <TextInput
            value={fullName}
            onChangeText={onNameChange}
            placeholder="Your full name"
            placeholderTextColor={token.mist}
            autoFocus
            autoCapitalize="words"
            autoComplete="name"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => usernameField.current?.focus()}
            accessibilityLabel="Full name"
            className="font-strong text-prose text-ink"
            style={{ padding: 0 }}
          />
        </View>
        {touched && nameError ? (
          <Text className="mt-2 font-body text-note text-slate">{nameError}</Text>
        ) : null}

        <Text className="mt-5 font-strong text-note text-slate">Username</Text>
        <View className="mt-2 flex-row items-center rounded-control border-[1.5px] border-line bg-card px-4 py-4">
          <Text className="font-strong text-prose text-slate">@</Text>
          <TextInput
            ref={usernameField}
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
            className="ml-1 flex-1 font-strong text-prose text-ink"
            style={{ padding: 0 }}
          />
        </View>
        {taken ? (
          <Text className="mt-2 font-body text-note text-halt">{USERNAME_TAKEN}</Text>
        ) : touched && usernameError ? (
          <Text className="mt-2 font-body text-note text-slate">{usernameError}</Text>
        ) : (
          <Text className="mt-2 font-body text-note text-slate">
            {check === 'free'
              ? 'That one is yours to take. People can pay you with it.'
              : 'Lowercase letters, numbers, dots and underscores.'}
          </Text>
        )}
        {problem ? <Text className="mt-5 font-body text-ui text-halt">{problem}</Text> : null}
      </ScrollView>

      <View className="flex-none px-gutter-lg pb-2.5 pt-3">
        <View className="flex-row">
          <Button
            label={account ? 'Continue' : 'Continue with passkey'}
            busy={saving}
            disabled={!canContinue}
            onPress={() => void submit()}
          />
        </View>
      </View>
    </Screen>
  );
}
