import { useState } from 'react';
import { KeyboardAvoidingView, TextInput, View } from 'react-native';

import { useThemeColors } from '@/lib/theme';

import { Button } from './Button';
import { Sheet, SheetLayer } from './Sheet';
import { Text } from './Text';

/**
 * The password a bank puts on a statement. A text field is right here: it is
 * a password, not an amount. It is held for this one reading and never kept.
 */
export function PasswordSheet({
  fileName,
  message,
  wrong,
  onSubmit,
  onDismiss,
}: {
  fileName: string;
  message: string;
  wrong: boolean;
  onSubmit: (password: string) => void;
  onDismiss: () => void;
}) {
  const colors = useThemeColors();
  const [password, setPassword] = useState('');
  const [focused, setFocused] = useState(false);
  // A new attempt starts clean: "that password didn't open it" is about the last one.
  const [typed, setTyped] = useState(false);
  const showWrong = wrong && !typed;

  return (
    <SheetLayer>
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <Sheet onDismiss={onDismiss}>
          <Text accessibilityRole="header" className="font-display text-subhead text-ink">
            This statement is locked
          </Text>
          <Text numberOfLines={1} className="mt-1 font-body text-note text-slate">
            {fileName}
          </Text>
          <Text
            accessibilityRole={showWrong ? 'alert' : undefined}
            className={`mt-3 font-body text-ui ${showWrong ? 'text-halt' : 'text-slate'}`}
          >
            {wrong && typed ? 'Enter the password your bank sent with it.' : message}
          </Text>

          <Text className="mt-5 font-strong text-note text-slate">Statement password</Text>
          <View
            className={`mt-2 rounded-control border-[1.5px] bg-card px-4 py-3 ${focused ? 'border-ink' : 'border-line'}`}
          >
            <TextInput
              value={password}
              onChangeText={(next) => {
                setPassword(next);
                setTyped(true);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              secureTextEntry
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => password && onSubmit(password)}
              accessibilityLabel="Statement password"
              placeholderTextColor={colors.mist}
              style={{ color: colors.ink, fontSize: 17, minHeight: 28 }}
            />
          </View>
          <Text className="mt-2 font-body text-note text-slate">
            Banks often use part of your date of birth or account number. It goes to the reader with the file and is
            not kept.
          </Text>

          <View className="mt-5 flex-row gap-2.5">
            <Button label="Cancel" variant="secondary" onPress={onDismiss} />
            <Button label="Open it" disabled={!password} onPress={() => onSubmit(password)} />
          </View>
        </Sheet>
      </KeyboardAvoidingView>
    </SheetLayer>
  );
}
