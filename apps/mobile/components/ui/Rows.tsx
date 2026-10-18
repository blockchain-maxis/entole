import { ChevronRight } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import type { Contact } from '@entole/core/schemas';

import { useThemeColors } from '@/lib/theme';

import { Avatar } from './Avatar';
import { Text } from './Text';

/** The two looks of a settings line. On the page a row is a ruled line: a
 * hairline under it and no box around it, because a border round every row made
 * every row equally important, and so none. On Me each setting is its own
 * thing to read and to press, so `boxed` gives it a card of its own, with room
 * inside and rounded corners, and the list puts a gap between the cards. */
const RULED_ROW = 'border-b border-hairline py-3.5';
const BOXED_ROW = 'rounded-control border border-line bg-card px-4 py-4';

/** "Amount   ₦75,000": a labelled value, as a ruled line on the page. */
export function DetailRow({
  label,
  value,
  tabular = true,
  boxed = false,
}: {
  label: string;
  value: string;
  tabular?: boolean;
  boxed?: boolean;
}) {
  return (
    <View className={`flex-row items-center justify-between gap-4 ${boxed ? BOXED_ROW : RULED_ROW}`}>
      <Text className="font-body text-ui text-slate">{label}</Text>
      <Text tabular={tabular} className="flex-shrink text-right font-strong text-ui text-ink">
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
  boxed = false,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  tone?: 'default' | 'danger';
  boxed?: boolean;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={`flex-row items-center justify-between gap-4 active:bg-press ${boxed ? BOXED_ROW : RULED_ROW}`}
    >
      <Text className={`font-strong text-ui ${tone === 'danger' ? 'text-halt' : 'text-ink'}`}>{label}</Text>
      <View className="flex-row items-center gap-1.5">
        {value ? <Text className="font-body text-ui text-slate">{value}</Text> : null}
        <ChevronRight size={16} strokeWidth={1.5} color={tone === 'danger' ? colors.halt.DEFAULT : colors.mist} />
      </View>
    </Pressable>
  );
}

/** A line inside a receipt breakdown. */
export function ReceiptLine({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-baseline justify-between gap-4 border-b border-hairline py-3">
      <Text className="font-body text-ui text-slate">{label}</Text>
      <Text tabular className="flex-shrink text-right font-strong text-ui text-ink">
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
      className="flex-row items-center gap-3 border-b border-hairline py-3 active:bg-press"
    >
      <Avatar initials={contact.initials} tone={contact.tone} size="md" />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="font-strong text-ui text-ink">
          {contact.name}
        </Text>
        {subtitle ? (
          <Text tabular numberOfLines={1} className="mt-0.5 font-body text-note text-slate">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}

/** A section's name, in the display face, with at most one quiet action. */
export function SectionHeading({
  title,
  action,
  onActionPress,
  className,
}: {
  title: string;
  action?: string | undefined;
  onActionPress?: () => void;
  className?: string;
}) {
  return (
    <View className={`flex-row items-baseline justify-between gap-4 pb-3 pt-10 ${className ?? ''}`}>
      <Text accessibilityRole="header" className="font-display text-subhead text-ink">
        {title}
      </Text>
      {action ? (
        <Pressable accessibilityRole="link" hitSlop={10} onPress={onActionPress}>
          <Text className="font-strong text-ui text-ink underline">{action}</Text>
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
          className={`h-1 w-[22px] rounded-pill ${index < done ? 'bg-ink' : 'bg-line'}`}
        />
      ))}
    </View>
  );
}
