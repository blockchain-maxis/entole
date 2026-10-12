import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { token } from '@entole/tokens';

/**
 * A scannable square. It encodes whatever it is given: on Receive that is the
 * pay link, which names the person by their username. Nothing in it reads as
 * an address, and whoever scans it goes to the same door as pasting.
 */
export function PaymentCode({ value, size = 208 }: { value: string; size?: number }) {
  // Always dark on white, in either theme: a light-on-dark square is one many
  // scanners will not read.
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Scannable QR code for your payment link"
      className="rounded-card border border-hairline bg-white p-3"
    >
      <QRCode value={value} size={size} color={token.ink} backgroundColor={token.white} />
    </View>
  );
}
