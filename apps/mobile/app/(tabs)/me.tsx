import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { FeedbackSheet } from '@/components/ui/FeedbackSheet';
import { Header } from '@/components/ui/Header';
import { PauseButton } from '@/components/ui/PauseButton';
import { DetailRow, LinkRow, SectionHeading } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { SheetLayer } from '@/components/ui/Sheet';
import { RowSkeleton, SettingRowSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';
import { GlassHost } from '@/lib/blur';
import { useAssistant } from '@/lib/assistant';
import {
  SESSION_LENGTH_MS,
  forgetEverything,
  hasStoredCredential,
  sessionStartedAt,
  signOut,
} from '@/lib/session';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { useStore } from '@entole/core/store';
import { useProfile } from '@/lib/profile';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** "Just now", "6 min ago": how long ago, in the words a person would use. */
function agoWords(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min ago`;
}

/** "In 24 min": how long until the app asks for the fingerprint again. */
function inWords(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  return minutes <= 1 ? 'In under a minute' : `In ${minutes} min`;
}

/**
 * When this phone was last unlocked and when it locks itself, counted from the
 * sign-in. Read once and then worked out from the clock every half minute, so
 * the screen is never stale and nothing is asked of the disk again.
 */
function useSessionClock() {
  const [startedAt, setStartedAt] = useState<number | null | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    void sessionStartedAt().then((value) => live && setStartedAt(value));
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  if (startedAt === undefined) return { known: false as const };
  if (startedAt === null) return { known: true as const, signedIn: false as const };
  const age = Math.max(0, now - startedAt);
  const left = SESSION_LENGTH_MS - age;
  return { known: true as const, signedIn: left > 0, age, left };
}

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
            className={`flex-1 items-center rounded-control py-2.5 ${active ? 'bg-ink' : ''}`}
          >
            <Text className={`font-strong text-note ${active ? 'text-paper' : 'text-slate'}`}>
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
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [credentialKnown, setCredentialKnown] = useState<boolean | null>(null);
  const profile = useProfile();
  const assistant = useAssistant();
  const clock = useSessionClock();

  useEffect(() => {
    let live = true;
    void hasStoredCredential().then((value) => live && setCredentialKnown(value));
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

  return (
    <Screen edges={{ bottom: false }}>
      <GlassHost
        sheet={
          feedbackOpen ? (
            <SheetLayer>
              <FeedbackSheet onDismiss={() => setFeedbackOpen(false)} />
            </SheetLayer>
          ) : null
        }
      >
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
              <Text numberOfLines={1} className="mt-3 max-w-full font-display text-subhead text-ink">
                {profile.fullName}
              </Text>
              {profile.username ? (
                <Text numberOfLines={1} className="mt-1 font-body text-ui text-slate">
                  @{profile.username}
                </Text>
              ) : null}
            </>
          ) : (
            <RowSkeleton />
          )}
        </View>

        <View>
          <SectionHeading title="Profile" />
          <View className="gap-2">
            <LinkRow boxed label="Edit profile" onPress={() => router.push('/edit-profile')} />
          </View>
        </View>

        <View>
          <SectionHeading title="Account" />
          {loading ? (
            <View className="gap-2">
              <SettingRowSkeleton />
              <SettingRowSkeleton />
              <SettingRowSkeleton />
            </View>
          ) : (
            <View className="gap-2">
              <DetailRow boxed label="Allowances" value={`${store.allowances.length} active`} tabular={false} />
              <LinkRow
                boxed
                label="Assistant"
                value={!assistant.enabled && !assistant.talking ? 'Off' : store.paused ? 'Paused' : 'On'}
                onPress={() => router.push('/assistant')}
              />
              <LinkRow
                boxed
                label="Beneficiaries"
                value={String(store.contacts.length)}
                onPress={() => router.push('/beneficiaries')}
              />
              <LinkRow boxed label="Connections" onPress={() => router.push('/connections')} />
            </View>
          )}
        </View>

        <View>
          <SectionHeading title="Preferences" />
          <Text className="mb-2.5 px-1 font-body text-note text-slate">Theme</Text>
          <ThemePicker />
        </View>

        <View>
          <SectionHeading title="Security" />
          <View className="gap-2">
            <DetailRow
              boxed
              label="Passkey"
              value={credentialKnown === null ? 'Checking' : credentialKnown ? 'Registered on this device' : 'Not registered'}
              tabular={false}
            />
            <DetailRow
              boxed
              label="Unlocked"
              value={!clock.known ? 'Checking' : clock.signedIn ? agoWords(clock.age) : 'Locked'}
              tabular={false}
            />
            <DetailRow
              boxed
              label="Locks itself"
              value={!clock.known ? 'Checking' : clock.signedIn ? inWords(clock.left) : 'Unlock to continue'}
              tabular={false}
            />
            <LinkRow
              boxed
              label={resetting ? 'Signing out everywhere' : 'Sign out everywhere'}
              tone="danger"
              onPress={() => void signOutEverywhere()}
            />
          </View>
        </View>

        <View>
          <SectionHeading title="Support" />
          <View className="gap-2">
            <LinkRow boxed label="Help center" onPress={() => router.push('/help')} />
            <LinkRow boxed label="Send feedback" onPress={() => setFeedbackOpen(true)} />
          </View>
        </View>

        <View>
          <SectionHeading title="Legal" />
          <View className="gap-2">
            <LinkRow boxed label="Terms" onPress={() => router.push('/legal/terms')} />
            <LinkRow boxed label="Privacy" onPress={() => router.push('/legal/privacy')} />
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
      </GlassHost>
    </Screen>
  );
}
