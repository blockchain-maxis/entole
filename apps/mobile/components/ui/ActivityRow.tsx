import { Pressable, View } from 'react-native';

import { relativeMoment } from '@entole/core/format';
import { formatDelta, kobo } from '@entole/core/money';
import type { Activity, Contact } from '@entole/core/schemas';

import { Avatar } from './Avatar';
import { AssistantBadge } from './Badge';
import { Text } from './Text';

/**
 * One line of the feed. An assistant-initiated payment carries the assistant
 * tint and the badge; your own payments sit on plain card.
 */
export function ActivityRow({
  entry,
  contact,
  onPress,
}: {
  entry: Activity;
  contact: Contact | undefined;
  onPress?: () => void;
}) {
  const byAssistant = entry.initiatedBy === 'assistant';
  const amount = formatDelta(kobo(entry.amountMinor), entry.direction);
  const pending = entry.state === 'pending';

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={`${contact?.name ?? 'Payment'}, ${entry.note}, ${amount}${
        byAssistant ? ', sent by Entole' : ''
      }`}
      disabled={!onPress}
      onPress={onPress}
      className={`flex-row items-center gap-3 rounded-row px-3.5 py-3 ${
        byAssistant
          ? 'border border-indigo-line bg-indigo-wash'
          : 'border border-transparent active:border-line active:bg-press'
      }`}
    >
      <Avatar initials={contact?.initials ?? '?'} tone={contact?.tone ?? 1} />

      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text className="font-strong text-body text-ink">{contact?.name ?? 'Someone'}</Text>
          {byAssistant ? <AssistantBadge /> : null}
        </View>
        <Text tabular className="mt-0.5 font-body text-caption text-slate">
          {entry.note} · {pending ? 'Sending' : relativeMoment(entry.at)}
        </Text>
      </View>

      <Text
        tabular
        className={`font-strong text-body ${
          pending ? 'text-mist' : entry.direction === 'in' ? 'text-settled' : 'text-ink'
        }`}
      >
        {amount}
      </Text>
    </Pressable>
  );
}
