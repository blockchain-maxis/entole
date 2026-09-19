import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { useThemeColors } from '@/lib/theme';

/**
 * The link, as a scannable square. Whoever scans it lands on a page that takes
 * a card or a bank app — they need no account and no download.
 */
export function PaymentCode({ link, size = 176 }: { link: string; size?: number }) {
  const colors = useThemeColors();
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Scannable code for ${link}`}
      className="rounded-row border border-hairline bg-paper p-3"
    >
      <QRCode
        value={`https://${link}`}
        size={size}
        color={colors.ink}
        backgroundColor={colors.paper}
      />
    </View>
  );
}
