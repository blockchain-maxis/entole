import { Circle, Path, Svg } from 'react-native-svg';

import { useThemeColors } from '@/lib/theme';

import { Text } from './Text';

/**
 * The Entole mark, as it is on the app icon: a blue ring left open, a dot at
 * its centre and a bar at nine o'clock. Drawn from the same shapes as
 * `assets/icon.png`, in the theme's own colours, so it holds in light and
 * dark. It is the one place blue is not the assistant's: it is the brand's.
 */
export function BrandGlyph({ size = 22 }: { size?: number }) {
  const colors = useThemeColors();
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Path d="M50 16 A34 34 0 1 1 16 50" stroke={colors.indigo.DEFAULT} strokeWidth={9} />
      <Path d="M4 50 H26" stroke={colors.ink} strokeWidth={9} />
      <Circle cx={50} cy={50} r={7} fill={colors.ink} />
    </Svg>
  );
}

/** The mark with the name beside it, for the screens before sign-in. */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <>
      <BrandGlyph size={size} />
      <Text className="font-display text-subhead text-ink">Entole</Text>
    </>
  );
}
