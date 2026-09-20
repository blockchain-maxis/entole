import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, TextInput, View } from 'react-native';

import { USERNAME_MAX, normalizeUsername, validateFullName, validateUsername } from '@entole/core/profile';
import { token } from '@entole/tokens';

import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';
import { storeProfile } from '@/lib/session';

/**
 * Change the name and username shown across the app. A bottom sheet, primary
 * action underneath. Format is checked here; uniqueness is not — there is no
 * backend to check it against yet (see `@entole/core/profile`).
 */
export default function EditProfile() {
  const router = useRouter();
  const { account, setAccount } = useAccount();
  const [fullName, setFullName] = useState(account?.displayName ?? '');
  const [username, setUsername] = useState(account?.username ?? '');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const nameError = validateFullName(fullName);
  const usernameError = validateUsername(username);
  const valid = !nameError && !usernameError;

  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/me'));

  async function save() {
    setTouched(true);
    if (!valid || !account || saving) return;
    setSaving(true);
    try {
      const profile = { fullName: fullName.trim(), username };
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
        <Text className="font-strong text-title text-ink">Edit profile</Text>

        <Text className="mt-5 font-strong text-caption text-slate">Full name</Text>
        <View className="mt-2 rounded-control border-[1.5px] border-indigo bg-card px-4 py-3.5">
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            placeholder="Your full name"
            placeholderTextColor={token.mist}
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

        <Text className="mt-4 font-strong text-caption text-slate">Username</Text>
        <View className="mt-2 flex-row items-center rounded-control border-[1.5px] border-line bg-card px-4 py-3.5">
          <Text className="font-strong text-body-lg text-slate">@</Text>
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
            className="ml-1 flex-1 font-strong text-body-lg text-ink"
            style={{ padding: 0 }}
          />
        </View>
        {touched && usernameError ? (
          <Text className="mt-2 font-body text-caption text-slate">{usernameError}</Text>
        ) : null}

        <View className="mt-6 flex-row">
          <Button label={saving ? 'Saving' : 'Save'} busy={saving} disabled={!valid} onPress={() => void save()} />
        </View>
      </Sheet>
    </KeyboardAvoidingView>
  );
}
