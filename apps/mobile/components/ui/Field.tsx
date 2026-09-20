import { useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { useThemeColors } from '@/lib/theme';

import { Text } from './Text';

type Props = Pick<
  TextInputProps,
  | 'value'
  | 'onChangeText'
  | 'placeholder'
  | 'autoCapitalize'
  | 'autoCorrect'
  | 'autoComplete'
  | 'keyboardType'
  | 'returnKeyType'
  | 'maxLength'
  | 'multiline'
  | 'onSubmitEditing'
  | 'editable'
  | 'onBlur'
> & {
  label: string;
  /** Small print under the field. */
  hint?: string;
  /** Plain-language problem with what is typed; replaces the hint. */
  error?: string | null;
  /** Something that sits at the end of the field, e.g. a Paste button. */
  trailing?: React.ReactNode;
  /** Marks the field as not required, in words. */
  optional?: boolean;
};

/**
 * A labelled text field. Not for money — an amount always goes through the
 * keypad. Names, notes, codes and bank details use the normal keyboard.
 */
export function Field({
  label,
  hint,
  error,
  trailing,
  optional = false,
  editable = true,
  onBlur,
  ...input
}: Props) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);

  return (
    <View>
      <View className="flex-row items-baseline justify-between">
        <Text className="font-strong text-caption text-slate">{label}</Text>
        {optional ? <Text className="font-body text-caption text-mist">Optional</Text> : null}
      </View>
      <View
        className={`mt-2 flex-row items-center rounded-control border-[1.5px] bg-card px-4 py-3.5 ${
          error ? 'border-halt' : focused ? 'border-indigo' : 'border-line'
        } ${editable ? '' : 'opacity-50'}`}
      >
        <TextInput
          {...input}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          placeholderTextColor={colors.mist}
          accessibilityLabel={label}
          className="min-w-0 flex-1 font-strong text-body-lg text-ink"
          style={{ padding: 0 }}
        />
        {trailing}
      </View>
      {error ? (
        <Text className="mt-2 font-body text-caption text-halt">{error}</Text>
      ) : hint ? (
        <Text className="mt-2 font-body text-caption text-slate">{hint}</Text>
      ) : null}
    </View>
  );
}
