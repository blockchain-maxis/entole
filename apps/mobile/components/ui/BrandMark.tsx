import { Path, Svg } from 'react-native-svg';

import { token } from '@entole/tokens';

import { Text } from './Text';

/** A rounded arch — safe passage for money, nothing coin- or chain-shaped.
 * Monoline, 2px, no fill. Pairs with the wordmark; never stands alone as a
 * favicon-style mark since the product has no app-icon design pass yet. */
export function BrandGlyph({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 20V10a6 6 0 0 1 12 0v10"
        stroke={token.ink}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <>
      <BrandGlyph size={size} />
      <Text className="font-strong text-headline tracking-tight text-ink">entole</Text>
    </>
  );
}
