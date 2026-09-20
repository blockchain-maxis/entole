import { Platform, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { useThemeColors } from '@/lib/theme';

import { Text } from './Text';

/**
 * The person's payment code as a scannable square. The code is opaque text —
 * whoever scans it (or types it) can pay this account, and nothing in it reads
 * as an address.
 */
export function PaymentCode({ code, size = 176 }: { code: string; size?: number }) {
  const colors = useThemeColors();
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Scannable payment code"
      className="rounded-row border border-hairline bg-paper p-3"
    >
      <QRCode value={code} size={size} color={colors.ink} backgroundColor={colors.paper} />
    </View>
  );
}

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

/** `PAY-AB12-CD34-…` -> the prefix, then rows of three groups of four. */
function layoutCode(code: string): { prefix: string; rows: string[][] } {
  const [prefix = '', ...groups] = code.split('-');
  const rows: string[][] = [];
  for (let index = 0; index < groups.length; index += 3) rows.push(groups.slice(index, index + 3));
  return { prefix, rows };
}

/**
 * The code written out for reading aloud or retyping: fixed-width, tabular,
 * grouped in fours. Every character is the same width, so no row jumps.
 */
export function PaymentCodeText({ code }: { code: string }) {
  const { prefix, rows } = layoutCode(code);
  const style = { fontFamily: MONO, fontVariant: ['tabular-nums' as const] };

  return (
    <View accessible accessibilityLabel={`Payment code ${code.split('-').join(' ')}`} className="items-center">
      <Text className="font-heavy text-badge uppercase text-mist">{prefix}</Text>
      <View className="mt-1.5 gap-1.5">
        {rows.map((row, index) => (
          <View key={index} className="flex-row justify-center gap-3.5">
            {row.map((group, position) => (
              <Text key={position} selectable style={style} className="text-title text-ink">
                {group}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}
