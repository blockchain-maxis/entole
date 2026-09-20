import { View } from 'react-native';

import { Text } from './Text';

/**
 * The mark that separates what Entole did from what you did. It appears on
 * every list, feed and detail view where an assistant action can show up.
 */
export function AssistantBadge({ label = 'Entole' }: { label?: string }) {
  return (
    <View className="rounded-[5px] border border-indigo-edge px-1.5 py-px">
      <Text className="font-heavy text-badge uppercase text-indigo">{label}</Text>
    </View>
  );
}

export function AssistantTag({ children }: { children: string }) {
  return (
    <View className="self-start rounded-md bg-indigo-wash px-2 py-1">
      <Text className="font-heavy text-badge uppercase text-indigo">{children}</Text>
    </View>
  );
}

export function SettledBadge({ children = 'Final' }: { children?: string }) {
  return (
    <View className="rounded-md bg-settled-wash px-2 py-1">
      <Text className="font-heavy text-badge uppercase text-settled">{children}</Text>
    </View>
  );
}

export function KillSwitchBadge() {
  return (
    <View className="flex-row items-center gap-2 self-start rounded-md bg-halt-wash px-2.5 py-1.5">
      <View className="h-2 w-2 rounded-[2px] bg-halt" />
      <Text className="font-heavy text-kill uppercase text-halt">Assistant</Text>
    </View>
  );
}
