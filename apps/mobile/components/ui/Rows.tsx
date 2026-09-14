import { Pressable, View } from 'react-native';

import type { Contact } from '@entole/core/schemas';

import { Avatar } from './Avatar';
import { Text } from './Text';

/** "Amount   ₦75,000" — a labelled value on a card. */
export function DetailRow({
  label,
  value,
  tabular = true,
}: {
  label: string;
  value: string;
  tabular?: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between rounded-control border border-line bg-card px-4 py-3.5">
      <Text className="font-body text-body-sm text-slate">{label}</Text>
      <Text tabular={tabular} className="font-strong text-body-sm text-ink">
        {value}
      </Text>
    </View>
  );
}

/** A line inside a receipt breakdown. */
export function ReceiptLine({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-baseline justify-between py-3">
      <Text className="font-body text-label text-slate">{label}</Text>
      <Text tabular className="font-strong text-label text-ink">
        {value}
      </Text>
    </View>
  );
}

/** Contacts first. A name and a face, never anything the recipient can't read. */
export function ContactRow({
  contact,
  trailing,
  onPress,
}: {
  contact: Contact;
  trailing?: React.ReactNode;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Send to ${contact.name}`}
      disabled={!onPress}
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-row border border-line bg-card px-3.5 py-3 active:border-mist"
    >
      <Avatar initials={contact.initials} tone={contact.tone} size="lg" />
      <View className="min-w-0 flex-1">
        <Text className="font-strong text-body text-ink">{contact.name}</Text>
        {contact.phone ? (
          <Text tabular className="mt-0.5 font-body text-caption text-slate">
            {contact.phone}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}

export function SectionHeading({
  title,
  action,
  onActionPress,
  className,
}: {
  title: string;
  action?: string;
  onActionPress?: () => void;
  className?: string;
}) {
  return (
    <View className={`flex-row items-baseline justify-between px-1 pb-3 ${className ?? ''}`}>
      <Text className="font-heavy text-body-sm text-ink">{title}</Text>
      {action ? (
        <Pressable accessibilityRole="link" hitSlop={10} onPress={onActionPress}>
          <Text className="font-strong text-label text-indigo">{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Onboarding progress. Three steps, under thirty seconds. */
export function StepDots({ total, done }: { total: number; done: number }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${done} of ${total}`}
      className="flex-row items-center gap-1.5"
    >
      {Array.from({ length: total }, (_, index) => (
        <View
          key={index}
          className={`h-1 w-[22px] rounded-pill ${index < done ? 'bg-indigo' : 'bg-line'}`}
        />
      ))}
    </View>
  );
}
