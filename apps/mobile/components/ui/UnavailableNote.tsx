import { View } from 'react-native';

import { Text } from './Text';

/** The honest empty state for a feature whose partner isn't connected yet. */
export function UnavailableNote({ title, body }: { title: string; body: string }) {
  return (
    <View className="rounded-control border border-line bg-card px-4 py-3.5">
      <Text className="font-strong text-body-sm text-caution">{title}</Text>
      <Text className="mt-1 font-body text-label-sm text-slate">{body}</Text>
    </View>
  );
}
