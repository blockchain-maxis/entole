import { useRouter } from 'expo-router';
import { ChevronRight, Search } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { Header } from '@/components/ui/Header';
import { PauseButton } from '@/components/ui/PauseButton';
import { SectionHeading } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useThemeColors } from '@/lib/theme';
import type { StockSearchResult } from '@entole/core/gateway';
import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';
import { formatShares } from '@entole/core/stock-broker';

/**
 * Stocks — holdings, and a search into the buy flow. When no broker is
 * configured the whole screen is one honest "not available yet" card: no
 * prices, no holdings, nothing that could be mistaken for the real thing.
 */
export default function Stocks() {
  const router = useRouter();
  const store = useStore();
  const colors = useThemeColors();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StockSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function search() {
    if (!query.trim() || searching) return;
    setSearching(true);
    setProblem(null);
    try {
      setResults(await store.searchStocks(query));
    } catch {
      setResults(null);
      setProblem('Search did not go through. Try again in a moment.');
    } finally {
      setSearching(false);
    }
  }

  return (
    <Screen edges={{ bottom: false }}>
      <Header title="Stocks" trailing={<PauseButton />} />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {!store.stocksAvailable ? (
          <View className="rounded-panel border border-line bg-card p-5">
            <Text className="font-heavy text-body text-ink">Stocks is not available yet</Text>
            <Text className="mt-2 font-body text-body-sm text-slate">
              Buying and selling shares is not switched on yet. Nothing here can move your money until it is.
            </Text>
          </View>
        ) : (
          <>
            <SectionHeading title="Holdings" className="pt-1" />
            {store.stockPositions.length === 0 ? (
              <Text className="px-1 font-body text-body-sm text-slate">You do not hold any shares yet.</Text>
            ) : (
              <View className="gap-2">
                {store.stockPositions.map((position) => (
                  <Pressable
                    key={position.symbol}
                    accessibilityRole="button"
                    accessibilityLabel={`${position.companyName}, ${formatShares(position.quantityScaled)} shares`}
                    onPress={() => router.push({ pathname: '/grow/stock/[symbol]', params: { symbol: position.symbol } })}
                    className="flex-row items-center justify-between rounded-control border border-line bg-card px-4 py-3.5 active:border-mist"
                  >
                    <View className="flex-1 pr-3">
                      <Text className="font-strong text-body-sm text-ink">{position.companyName}</Text>
                      <Text className="mt-0.5 font-body text-label-sm text-slate">
                        {position.symbol} · {formatShares(position.quantityScaled)} shares
                      </Text>
                    </View>
                    <View className="flex-row items-center gap-1.5">
                      <Text tabular className="font-strong text-body-sm text-ink">
                        {formatNaira(kobo(position.currentValueMinor))}
                      </Text>
                      <ChevronRight size={16} strokeWidth={1.5} color={colors.mist} />
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            <SectionHeading title="Buy stock" className="pt-6" />
            <View className="flex-row items-center gap-2.5 rounded-control border border-line bg-card px-4 py-3.5">
              <Search size={18} strokeWidth={1.5} color={colors.mist} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search a company or symbol"
                placeholderTextColor={colors.mist}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={() => void search()}
                accessibilityLabel="Search stocks"
                className="flex-1 font-body text-body text-ink"
                style={{ padding: 0 }}
              />
            </View>

            {problem ? <Text className="mt-3 px-1 font-body text-label-sm text-halt">{problem}</Text> : null}

            {searching ? (
              <Text className="mt-3 px-1 font-body text-label-sm text-slate">Searching</Text>
            ) : results ? (
              results.length === 0 ? (
                <Text className="mt-3 px-1 font-body text-body-sm text-slate">No matches.</Text>
              ) : (
                <View className="mt-3 gap-2">
                  {results.map((result) => (
                    <Pressable
                      key={result.symbol}
                      accessibilityRole="button"
                      accessibilityLabel={`Buy ${result.name}`}
                      onPress={() => router.push({ pathname: '/grow/stock/[symbol]', params: { symbol: result.symbol } })}
                      className="flex-row items-center justify-between rounded-control border border-line bg-card px-4 py-3.5 active:border-mist"
                    >
                      <View className="flex-1 pr-3">
                        <Text className="font-strong text-body-sm text-ink">{result.name}</Text>
                        <Text className="mt-0.5 font-body text-label-sm text-slate">{result.symbol}</Text>
                      </View>
                      <ChevronRight size={16} strokeWidth={1.5} color={colors.mist} />
                    </Pressable>
                  ))}
                </View>
              )
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
