import { FlashList } from '@shopify/flash-list';
import { Check } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Pressable, TextInput, View, useWindowDimensions } from 'react-native';

import { countryName, searchCountries, type Country } from '@entole/core/countries';

import { useThemeColors } from '@/lib/theme';

import { Sheet, SheetLayer } from './Sheet';
import { Text } from './Text';

/**
 * A row that shows the chosen country and asks its screen to open the list —
 * the sheet itself is rendered by the screen (`CountrySheet`), because a
 * sheet has to cover the whole screen, not sit inside a scrolling form.
 */
export function CountryField({ value, onPress }: { value: string | undefined; onPress: () => void }) {
  const name = countryName(value);

  return (
    <View>
      <View className="flex-row items-baseline justify-between">
        <Text className="font-strong text-caption text-slate">Country</Text>
        <Text className="font-body text-caption text-mist">Optional</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name ? `Country, ${name}. Change` : 'Choose a country'}
        onPress={onPress}
        className="mt-2 flex-row items-center justify-between rounded-control border-[1.5px] border-line bg-card px-4 py-3.5 active:border-mist"
      >
        <Text className={`font-strong text-body-lg ${name ? 'text-ink' : 'text-mist'}`}>
          {name ?? 'Choose a country'}
        </Text>
        <Text className="font-strong text-label text-indigo">{name ? 'Change' : 'Choose'}</Text>
      </Pressable>
    </View>
  );
}

export function CountrySheet({
  value,
  onPick,
  onDismiss,
}: {
  value: string | undefined;
  onPick: (code: string | undefined) => void;
  onDismiss: () => void;
}) {
  const colors = useThemeColors();
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchCountries(query), [query]);

  return (
    <SheetLayer>
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <Sheet onDismiss={onDismiss} handleOnly topInset={72}>
          <View className="flex-row items-baseline justify-between">
            <Text className="font-strong text-title text-ink">Country</Text>
            {value ? (
              <Pressable accessibilityRole="button" hitSlop={10} onPress={() => onPick(undefined)}>
                <Text className="font-strong text-label text-slate">Clear</Text>
              </Pressable>
            ) : null}
          </View>

          <View className="mt-4 flex-row items-center rounded-control border-[1.5px] border-line bg-card px-4 py-3">
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search countries"
              placeholderTextColor={colors.mist}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search countries"
              className="min-w-0 flex-1 font-strong text-body text-ink"
              style={{ padding: 0 }}
            />
          </View>

          <View style={{ height: Math.min(420, height * 0.5) }} className="mt-2">
            <FlashList<Country>
              data={results}
              keyExtractor={(country) => country.code}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <Text className="px-1 py-6 font-body text-body-sm text-slate">
                  No country matches that. Check the spelling.
                </Text>
              }
              renderItem={({ item }) => {
                const selected = item.code === value;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => onPick(item.code)}
                    className="flex-row items-center justify-between border-b border-hairline px-1 py-3.5 active:bg-press"
                  >
                    <Text className={`font-body text-body ${selected ? 'text-indigo' : 'text-ink'}`}>
                      {item.name}
                    </Text>
                    {selected ? <Check size={18} strokeWidth={2} color={colors.indigo.DEFAULT} /> : null}
                  </Pressable>
                );
              }}
            />
          </View>
        </Sheet>
      </KeyboardAvoidingView>
    </SheetLayer>
  );
}

