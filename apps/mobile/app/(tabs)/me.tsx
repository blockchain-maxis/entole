import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { PauseButton } from '@/components/ui/PauseButton';
import { DetailRow, SectionHeading } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';
import { signOut } from '@/lib/session';
import { useStore } from '@entole/core/store';

export default function Me() {
  const router = useRouter();
  const store = useStore();
  const { setAccount } = useAccount();
  const loading = store.status === 'loading';
  const [locking, setLocking] = useState(false);

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

  return (
    <Screen edges={{ bottom: false }}>
      <Header title="Me" trailing={<PauseButton />} />

      <View className="px-5 pt-2">
        <View className="items-center py-6">
          <Avatar initials="AE" tone={1} size="hero" />
          <Text className="mt-3 font-strong text-title text-ink">Adaeze</Text>
          <Text className="mt-1 font-body text-label-sm text-slate">Lagos, Nigeria</Text>
        </View>

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

        <View className="mt-8">
          <Button
            label={locking ? 'Locking' : 'Lock'}
            variant="secondary"
            busy={locking}
            disabled={loading}
            onPress={() => void lock()}
          />
        </View>
      </View>
    </Screen>
  );
}
