import { useState } from 'react';
import { Image, View } from 'react-native';

import { Text } from './Text';

const BOX = { 40: 'h-10 w-10', 52: 'h-[52px] w-[52px]' } as const;

/**
 * A company's own mark, as published with its listing. If there is none, or
 * it does not load, the first letter of its name stands in.
 */
export function StockLogo({ src, name, size = 40 }: { src?: string | undefined; name: string; size?: keyof typeof BOX }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className={`items-center justify-center rounded-pill bg-press ${BOX[size]}`}
      >
        <Text className="font-strong text-label text-slate">{name.trim().charAt(0).toUpperCase()}</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: src }}
      accessibilityIgnoresInvertColors
      onError={() => setFailed(true)}
      className={`rounded-pill bg-press ${BOX[size]}`}
    />
  );
}
