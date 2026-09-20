import { ChevronRight } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import type { Contact } from '@entole/core/schemas';

import { useThemeColors } from '@/lib/theme';

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

/** A tappable settings row — a label, an optional trailing value, a
 * chevron. Used throughout the expanded Me screen (Security/Support/Legal
 * rows); `tone="danger"` for a destructive action like signing out
 * everywhere. */
export function LinkRow({
  label,
  value,
  onPress,
  tone = 'default',
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  tone?: 'default' | 'danger';
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center justify-between rounded-control border border-line bg-card px-4 py-3.5 active:border-mist"
    >
      <Text className={`font-body text-body-sm ${tone === 'danger' ? 'text-halt' : 'text-ink'}`}>{label}</Text>
      <View className="flex-row items-center gap-1.5">
        {value ? <Text className="font-body text-body-sm text-slate">{value}</Text> : null}
        <ChevronRight size={16} strokeWidth={1.5} color={tone === 'danger' ? colors.halt.DEFAULT : colors.mist} />
      </View>
    </Pressable>
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

/** People first. A name and a face, never anything the recipient can't read. */
export function ContactRow({
  contact,
  trailing,
  onPress,
  caption,
  accessibilityLabel,
}: {
  contact: Contact;
  trailing?: React.ReactNode;
  onPress?: () => void;
  /** Small print under the name — a country, say. Replaces a phone number. */
  caption?: string;
  accessibilityLabel?: string;
}) {
  const subtitle = caption ?? contact.phone;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `Send to ${contact.name}`}
      disabled={!onPress}
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-row border border-line bg-card px-3.5 py-3 active:border-mist"
    >
      <Avatar initials={contact.initials} tone={contact.tone} size="lg" />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="font-strong text-body text-ink">
          {contact.name}
        </Text>
        {subtitle ? (
          <Text tabular numberOfLines={1} className="mt-0.5 font-body text-caption text-slate">
            {subtitle}
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
