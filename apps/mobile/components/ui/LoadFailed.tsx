import { View } from 'react-native';

import { useReload } from '@/lib/reload';

import { Button } from './Button';
import { Text } from './Text';

/** A read that failed: what happened, in plain words, and a way to try again. */
export function LoadFailed({ title, body }: { title: string; body: string }) {
  const { reload, reloading } = useReload();

  return (
    <View className="rounded-panel bg-card p-6 shadow-raised">
      <Text className="font-strong text-title text-ink">{title}</Text>
      <Text className="mt-2 font-body text-body-sm text-slate">{body}</Text>
      <View className="mt-4 flex-row">
        <Button
          label={reloading ? 'Trying again' : 'Retry'}
          variant="secondary"
          width="hug"
          disabled={reloading}
          onPress={() => void reload()}
        />
      </View>
    </View>
  );
}
