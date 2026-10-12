import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, TextInput, View } from 'react-native';

import { useBackend } from '@entole/core/backend';
import { DirectoryError } from '@entole/core/directory';
import {
  USERNAME_MAX,
  initialsFor,
  normalizeUsername,
  validateFullName,
  validateUsername,
} from '@entole/core/profile';
import { USERNAME_TAKEN, useUsernameCheck } from '@entole/core/username-check';
import { token } from '@entole/tokens';

import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';
import { API_BASE } from '@/lib/onchain';
import { recordUsernameClaim, storeProfile } from '@/lib/session';
import { useToast } from '@/lib/toast';

/**
 * Change the name and username shown across the app. A bottom sheet, primary
 * action underneath. A username is one person's: the directory is asked as it
 * is typed, and saving claims it. If someone else holds it, nothing is saved.
 *
 * The name also re-publishes to the identity directory if this account has
 * ever claimed one (a phone link, or being resolved as a stranger's code) —
 * otherwise a name change here would only be visible on this device, not to
 * anyone the new name is supposed to reach. Omitting `phone` from this call
 * is deliberate: the server keeps whatever phone link is already on file.
 */
export default function EditProfile() {
  const router = useRouter();
  const { account, setAccount } = useAccount();
  const backend = useBackend();
  const { show } = useToast();
  const [fullName, setFullName] = useState(account?.displayName ?? '');
  const [username, setUsername] = useState(account?.username ?? '');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  // Opened by the app itself when the name on this phone turned out to be
  // someone else's.
  const sentHere = useLocalSearchParams<{ taken?: string }>().taken === '1';

  const check = useUsernameCheck(API_BASE, username, account?.owner.address);
  const taken = check === 'taken' || refused === username;
  const nameError = validateFullName(fullName);
  const usernameError = validateUsername(username) ?? (taken ? USERNAME_TAKEN : null);
  const valid = !nameError && !usernameError && check !== 'checking';

  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/me'));

  async function save() {
    setTouched(true);
    if (!valid || !account || saving) return;
    setSaving(true);
    try {
      const profile = { fullName: fullName.trim(), username };
      // The directory first: it is what makes the username this person's. If
      // someone else holds it, nothing is saved. Any other failure keeps the
      // change on this phone and says that others cannot see it yet.
      try {
        await backend.directory.claim({
          address: account.owner.address,
          name: profile.fullName,
          initials: initialsFor(profile.fullName),
          tone: 1,
          username,
        });
        await recordUsernameClaim(account.owner.address, username);
      } catch (error) {
        if (error instanceof DirectoryError && error.code === 'username_taken') {
          setRefused(username);
          return;
        }
        show(error instanceof DirectoryError ? error.message : "Saved here, but couldn't update what others see.");
      }
      await storeProfile(profile);
      setAccount({ ...account, displayName: profile.fullName, username: profile.username });
      close();
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1">
      <Sheet onDismiss={close}>
        <Text className="font-display text-subhead text-ink">Edit profile</Text>
        {sentHere ? (
          <Text className="mt-2 font-body text-ui text-slate">
            Someone else already has your username. Choose another so people can find and pay you.
          </Text>
        ) : null}

        <Text className="mt-5 font-strong text-note text-slate">Full name</Text>
        <View className="mt-2 rounded-control border-[1.5px] border-ink bg-card px-4 py-3.5">
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            placeholder="Your full name"
            placeholderTextColor={token.mist}
            autoCapitalize="words"
            autoComplete="name"
            returnKeyType="next"
            accessibilityLabel="Full name"
            className="font-strong text-prose text-ink"
            style={{ padding: 0 }}
          />
        </View>
        {touched && nameError ? (
          <Text className="mt-2 font-body text-note text-slate">{nameError}</Text>
        ) : null}

        <Text className="mt-4 font-strong text-note text-slate">Username</Text>
        <View className="mt-2 flex-row items-center rounded-control border-[1.5px] border-line bg-card px-4 py-3.5">
          <Text className="font-strong text-prose text-slate">@</Text>
          <TextInput
            value={username}
            onChangeText={(next) => setUsername(normalizeUsername(next))}
            placeholder="username"
            placeholderTextColor={token.mist}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={USERNAME_MAX}
            returnKeyType="done"
            onSubmitEditing={() => void save()}
            accessibilityLabel="Username"
            className="ml-1 flex-1 font-strong text-prose text-ink"
            style={{ padding: 0 }}
          />
        </View>
        {taken ? (
          <Text className="mt-2 font-body text-note text-halt">{USERNAME_TAKEN}</Text>
        ) : touched && usernameError ? (
          <Text className="mt-2 font-body text-note text-slate">{usernameError}</Text>
        ) : null}

        <View className="mt-6 flex-row">
          <Button label={saving ? 'Saving' : 'Save'} busy={saving} disabled={!valid} onPress={() => void save()} />
        </View>
      </Sheet>
    </KeyboardAvoidingView>
  );
}
