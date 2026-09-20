import { Platform, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { token } from '@entole/tokens';

import { Text } from './Text';

/**
 * A scannable square. It encodes whatever it is given: on Receive that is the
 * checkout link, which names the account by its payment code. Nothing in it
 * reads as an address, and whoever scans it goes to the same door as pasting.
 */
export function PaymentCode({ value, size = 208 }: { value: string; size?: number }) {
  // Always dark on white, in either theme: a light-on-dark square is one many
  // scanners will not read.
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Scannable QR code for your payment link"
      className="rounded-row border border-hairline bg-white p-3"
    >
      <QRCode value={value} size={size} color={token.ink} backgroundColor={token.white} />
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
    <View
      accessible
      accessibilityLabel={`Payment code ${code.split('-').join(' ')}`}
      className="items-center"
    >
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
