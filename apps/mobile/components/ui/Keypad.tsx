import * as Haptics from 'expo-haptics';
import { Pressable, View } from 'react-native';

import { KEYPAD_KEYS, type KeypadKey } from '@entole/core/amount-entry';

import { Text } from './Text';

/**
 * The only way to enter an amount. The system keyboard never opens for money:
 * it shifts the layout, it hides the balance, and it does not do tabular
 * figures.
 */
export function Keypad({ onKey }: { onKey: (key: KeypadKey) => void }) {
  return (
    <View className="flex-row flex-wrap" style={{ marginHorizontal: -4 }}>
      {KEYPAD_KEYS.map((key) => (
        <View key={key} className="w-1/3 p-1">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={key === '⌫' ? 'Delete last digit' : key}
            onPress={() => {
              void Haptics.selectionAsync();
              onKey(key);
            }}
            className="items-center justify-center rounded-control border border-line bg-card py-[15px] active:bg-press"
          >
            <Text tabular className="font-body text-key text-ink">
              {key}
            </Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
