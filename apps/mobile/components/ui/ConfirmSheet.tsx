import { View } from 'react-native';

import { Button } from './Button';
import { Sheet, SheetLayer } from './Sheet';
import { Text } from './Text';

/**
 * A yes/no as a bottom sheet, for the few actions that cannot be undone. The
 * confirming action is on the right, under the thumb; `busy` keeps the sheet
 * from being swiped away while it is working.
 */
export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  tone = 'default',
  busy = false,
  problem,
  onConfirm,
  onDismiss,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  tone?: 'default' | 'danger';
  busy?: boolean;
  problem?: string | null;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <SheetLayer>
      <Sheet onDismiss={onDismiss} locked={busy}>
        <Text className="font-strong text-title text-ink">{title}</Text>
        <Text className="mt-2 font-body text-body-sm text-slate">{body}</Text>
        {problem ? <Text className="mt-3 font-body text-label-sm text-halt">{problem}</Text> : null}
        <View className="mt-5 flex-row gap-2.5">
          <Button label="Not now" variant="secondary" disabled={busy} onPress={onDismiss} />
          <Button
            label={confirmLabel}
            variant={tone === 'danger' ? 'destructive' : 'primary'}
            busy={busy}
            onPress={onConfirm}
          />
        </View>
      </Sheet>
    </SheetLayer>
  );
}
