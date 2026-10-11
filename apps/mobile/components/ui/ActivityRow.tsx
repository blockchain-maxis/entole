import { Pressable, View } from 'react-native';

import { relativeMoment } from '@entole/core/format';
import { formatDelta, kobo } from '@entole/core/money';
import type { Activity, Contact } from '@entole/core/schemas';

import { Avatar } from './Avatar';
import { AssistantBadge } from './Badge';
import { Text } from './Text';

/** Whether the assistant made this payment. A list uses it to decide where a
 * hairline belongs: never against a tinted row, which is already set apart. */
export function byAssistant(entry: Activity): boolean {
  return entry.initiatedBy === 'assistant';
}

/**
 * One line of the feed, on paper. Your own payments are plain; one the
 * assistant made carries the assistant's tint and its badge, so the two can
 * never be mistaken for each other. `ruled` draws the hairline above a row.
 */
export function ActivityRow({
  entry,
  contact,
  ruled = false,
  onPress,
}: {
  entry: Activity;
  contact: Contact | undefined;
  ruled?: boolean;
  onPress?: () => void;
}) {
  const assistant = byAssistant(entry);
  const amount = formatDelta(kobo(entry.amountMinor), entry.direction);
  const pending = entry.state === 'pending';

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={`${contact?.name ?? 'Payment'}, ${entry.note}, ${amount}${
        assistant ? ', sent by the assistant' : ''
      }`}
      disabled={!onPress}
      onPress={onPress}
      className={`flex-row items-center gap-3 py-3 ${
        assistant
          ? '-mx-3 rounded-control bg-indigo-wash px-3 active:opacity-80'
          : `active:bg-press ${ruled ? 'border-t border-hairline' : ''}`
      }`}
    >
      <Avatar initials={contact?.initials ?? '?'} tone={contact?.tone ?? 1} />

      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text numberOfLines={1} className="flex-shrink font-strong text-ui text-ink">
            {contact?.name ?? 'Someone'}
          </Text>
          {assistant ? <AssistantBadge /> : null}
        </View>
        <Text tabular numberOfLines={1} className="mt-0.5 font-body text-note text-slate">
          {entry.note} · {pending ? 'Sending' : relativeMoment(entry.at)}
        </Text>
      </View>

      <Text
        tabular
        className={`font-strong text-ui ${
          pending ? 'text-slate' : entry.direction === 'in' ? 'text-settled' : 'text-ink'
        }`}
      >
        {amount}
      </Text>
    </Pressable>
  );
}
