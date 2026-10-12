import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { useProfile } from '@/lib/profile';

import { Avatar } from './Avatar';
import { Skeleton } from './Skeleton';
import { Text } from './Text';

/**
 * Who this is, in the header's leading slot — the person's own photo-or-initials,
 * full name, and "@username · ENT-XXXX-XXXX". Replaces the brand mark: people
 * know what app they opened. Taps through to Me.
 *
 * `min-w-0 flex-1` so a long name truncates instead of pushing the assistant
 * chip off screen; the chip in `Header`'s trailing slot stays `flex-none`.
 *
 * TODO(photo): `Avatar` shows initials until a picture exists. Choosing one
 * needs a native image picker (expo-image-picker) and so a new dev-client build.
 */
export function ProfileChip() {
  const router = useRouter();
  const profile = useProfile();

  if (!profile) {
    return (
      <View className="min-w-0 flex-1 flex-row items-center gap-3">
        <Skeleton className="h-[38px] w-[38px] rounded-pill" />
        <View className="min-w-0 flex-1">
          <Skeleton className="h-4 w-28 rounded-md" />
          <Skeleton className="mt-1.5 h-3 w-36 rounded-md" />
        </View>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${profile.fullName}, your profile`}
      onPress={() => router.navigate('/me')}
      className="min-w-0 flex-1 flex-row items-center gap-3"
    >
      <Avatar initials={profile.initials} size="sm" />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="font-strong text-ui text-ink">
          {profile.fullName}
        </Text>
        {profile.username ? (
          <Text numberOfLines={1} className="font-body text-note text-slate">
            @{profile.username}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
