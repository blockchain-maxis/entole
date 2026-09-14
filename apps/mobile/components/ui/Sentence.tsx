import { Pressable, View } from 'react-native';

import type { AvatarTone } from '@entole/core/schemas';

import { Text } from './Text';

/**
 * The rule builder is a sentence you read back in one breath, not a form and
 * not a wizard. Words are words; every value is a pill you can tap.
 */

export type SentencePart =
  | { kind: 'words'; text: string }
  | {
      kind: 'pill';
      id: string;
      text: string;
      /** A recipient pill carries the person, so the rule stays about people. */
      avatar?: { initials: string; tone: AvatarTone };
      tabular?: boolean;
    };

export function Sentence({
  parts,
  activeId,
  onPressPill,
}: {
  parts: SentencePart[];
  activeId?: string;
  onPressPill: (id: string) => void;
}) {
  return (
    <View className="flex-row flex-wrap items-center">
      {parts.map((part, index) =>
        part.kind === 'words' ? (
          <Text key={`w-${index}`} className="font-body text-sentence text-ink">
            {part.text}
          </Text>
        ) : (
          <Pill
            key={part.id}
            part={part}
            active={part.id === activeId}
            onPress={() => onPressPill(part.id)}
          />
        ),
      )}
    </View>
  );
}

function Pill({
  part,
  active,
  onPress,
}: {
  part: Extract<SentencePart, { kind: 'pill' }>;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`Change ${part.text}`}
      onPress={onPress}
      className={`my-1 flex-row items-center rounded-pip border py-0.5 ${
        part.avatar ? 'pl-1 pr-2.5' : 'px-2.5'
      } ${active ? 'border-indigo bg-indigo' : 'border-line bg-card'}`}
    >
      {part.avatar ? (
        <View
          className={`mr-1.5 h-[26px] w-[26px] rounded-pill ${
            part.avatar.tone === 1 ? 'bg-avatar-1' : part.avatar.tone === 2 ? 'bg-avatar-2' : 'bg-avatar-3'
          }`}
        />
      ) : null}
      <Text
        tabular={part.tabular}
        className={`font-strong text-sentence ${active ? 'text-card' : 'text-ink'}`}
      >
        {part.text}
      </Text>
    </Pressable>
  );
}
