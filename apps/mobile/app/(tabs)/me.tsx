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
import { useAssistant } from '@/lib/assistant';
import { forgetEverything, hasStoredCredential, sessionIsFresh, signOut } from '@/lib/session';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { useStore } from '@entole/core/store';
import { useProfile } from '@/lib/profile';

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
            onPress={(event) =>
              setPreference(option.value, { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY })
            }
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
  const { setAccount } = useAccount();
  const loading = store.status === 'loading';
  const [locking, setLocking] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [credentialKnown, setCredentialKnown] = useState<boolean | null>(null);
  const [sessionFresh, setSessionFresh] = useState<boolean | null>(null);
  const profile = useProfile();
  const assistant = useAssistant();

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
      <Header title="Me" leading="none" trailing={<PauseButton />} />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, gap: 28 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center py-4">
          {profile ? (
            <>
              {/* TODO(photo): initials until a picture can be chosen — needs a native image picker and a rebuild. */}
              <Avatar initials={profile.initials} tone={1} size="hero" />
              <Text numberOfLines={1} className="mt-3 max-w-full font-strong text-title text-ink">
                {profile.fullName}
              </Text>
              {profile.username ? (
                <Text numberOfLines={1} className="mt-1 font-body text-body-sm text-slate">
                  @{profile.username}
                </Text>
              ) : null}
              <Text tabular className="mt-0.5 font-body text-label-sm text-mist">
                {profile.code}
              </Text>
            </>
          ) : (
            <RowSkeleton />
          )}
        </View>

        <View>
          <SectionHeading title="Profile" />
          <View className="gap-2">
            <LinkRow label="Edit profile" onPress={() => router.push('/edit-profile')} />
          </View>
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
              <LinkRow
                label="Assistant"
                value={!assistant.enabled ? 'Off' : store.paused ? 'Paused' : 'On'}
                onPress={() => router.push('/assistant')}
              />
              <LinkRow
                label="Beneficiaries"
                value={String(store.contacts.length)}
                onPress={() => router.push('/beneficiaries')}
              />
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
