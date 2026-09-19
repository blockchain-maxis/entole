import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { PauseButton } from '@/components/ui/PauseButton';
import { DetailRow, LinkRow, SectionHeading } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';
import { forgetEverything, hasStoredCredential, sessionIsFresh, signOut } from '@/lib/session';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { useStore } from '@entole/core/store';

/** First + last initial, uppercased. Falls back to "?" for an empty name. */
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function ThemePicker() {
  const { preference, setPreference } = useTheme();
  return (
    <View className="flex-row gap-2 rounded-control border border-line bg-card p-1.5">
      {THEME_OPTIONS.map((option) => {
        const active = preference === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => setPreference(option.value)}
            className={`flex-1 items-center rounded-chip py-2.5 ${active ? 'bg-indigo-wash' : ''}`}
          >
            <Text className={`font-strong text-label-sm ${active ? 'text-ink' : 'text-mist'}`}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function Me() {
  const router = useRouter();
  const store = useStore();
  const { account, setAccount } = useAccount();
  const loading = store.status === 'loading';
  const [locking, setLocking] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [credentialKnown, setCredentialKnown] = useState<boolean | null>(null);
  const [sessionFresh, setSessionFresh] = useState<boolean | null>(null);
  const displayName = account?.displayName.trim() || 'there';

  useEffect(() => {
    let live = true;
    void hasStoredCredential().then((value) => live && setCredentialKnown(value));
    void sessionIsFresh().then((value) => live && setSessionFresh(value));
    return () => {
      live = false;
    };
  }, []);

  async function lock() {
    setLocking(true);
    try {
      await signOut();
      setAccount(null);
      router.replace('/lock');
    } finally {
      setLocking(false);
    }
  }

  async function signOutEverywhere() {
    setResetting(true);
    try {
      await forgetEverything();
      setAccount(null);
      router.replace('/onboarding');
    } finally {
      setResetting(false);
    }
  }

  function contactSupport(subject: string) {
    void Linking.openURL(`mailto:support@entole.to?subject=${encodeURIComponent(subject)}`);
  }

  return (
    <Screen edges={{ bottom: false }}>
      <Header title="Me" trailing={<PauseButton />} />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, gap: 28 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center py-4">
          <Avatar initials={initialsFor(displayName)} tone={1} size="hero" />
          <Text className="mt-3 font-strong text-title text-ink">{displayName}</Text>
          <Text className="mt-1 font-body text-label-sm text-slate">Lagos, Nigeria</Text>
        </View>

        <View>
          <SectionHeading title="Account" />
          {loading ? (
            <View className="gap-2">
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </View>
          ) : (
            <View className="gap-2">
              <DetailRow label="Allowances" value={`${store.allowances.length} active`} tabular={false} />
              <DetailRow label="Corridor" value="NG ↔ US" tabular={false} />
              <DetailRow label="Status" value={store.paused ? 'Paused' : 'Active'} tabular={false} />
            </View>
          )}
        </View>

        <View>
          <SectionHeading title="Security" />
          <View className="gap-2">
            <DetailRow
              label="Passkey"
              value={credentialKnown === null ? 'Checking' : credentialKnown ? 'Registered on this device' : 'Not registered'}
              tabular={false}
            />
            <DetailRow
              label="Session"
              value={sessionFresh === null ? 'Checking' : sessionFresh ? 'Active' : 'Expired'}
              tabular={false}
            />
            <LinkRow
              label={resetting ? 'Signing out everywhere' : 'Sign out everywhere'}
              tone="danger"
              onPress={() => void signOutEverywhere()}
            />
          </View>
        </View>

        <View>
          <SectionHeading title="Preferences" />
          <Text className="mb-2.5 px-1 font-body text-label-sm text-slate">Theme</Text>
          <ThemePicker />
        </View>

        <View>
          <SectionHeading title="Support" />
          <View className="gap-2">
            <LinkRow label="Help center" onPress={() => contactSupport('Help')} />
            <LinkRow label="Send feedback" onPress={() => contactSupport('Feedback')} />
          </View>
        </View>

        <View>
          <SectionHeading title="Legal" />
          <View className="gap-2">
            <LinkRow label="Terms" onPress={() => router.push('/legal/terms')} />
            <LinkRow label="Privacy" onPress={() => router.push('/legal/privacy')} />
          </View>
        </View>

        <View className="pb-6">
          <Button
            label={locking ? 'Locking' : 'Lock'}
            variant="secondary"
            busy={locking}
            disabled={loading}
            onPress={() => void lock()}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
