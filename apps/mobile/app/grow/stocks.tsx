import { useRouter } from 'expo-router';
import { ChevronRight, Search } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import type { StockSearchResult } from '@entole/core/gateway';
import { useStore } from '@entole/core/store';

import { Header } from '@/components/ui/Header';
import { HoldingRow } from '@/components/ui/HoldingRow';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { PauseButton } from '@/components/ui/PauseButton';
import { SectionHeading } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { plainMessage } from '@/lib/send';
import { useThemeColors } from '@/lib/theme';

/**
 * Stocks — holdings, and a search into the buy flow. Until a brokerage partner
 * is connected the whole screen is one honest note: no prices, no holdings,
 * nothing that could be mistaken for the real thing.
 */
export default function Stocks() {
  const router = useRouter();
  const store = useStore();
  const colors = useThemeColors();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StockSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const loading = store.status === 'loading';
  const failed = store.status === 'failed';

  async function search() {
    if (!query.trim() || searching) return;
    setSearching(true);
    setProblem(null);
    try {
      setResults(await store.searchStocks(query));
    } catch (error) {
      setResults(null);
      setProblem(plainMessage(error, "Search didn't go through. Try again in a moment."));
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
          <View className="rounded-row border border-line bg-card p-4">
            <Text className="font-heavy text-body-sm text-ink">Stocks</Text>
            <Text className="mt-2 font-body text-label-sm text-slate">
              Buying stocks opens when our brokerage partner is connected.
            </Text>
            <Text className="mt-2 font-body text-label-sm text-slate">
              Nothing here can move your money until then.
            </Text>
          </View>
        ) : failed ? (
          <LoadFailed
            title="We can't load your holdings"
            body="Your holdings couldn't be read just now. Nothing has changed. Check your connection and try again."
          />
        ) : (
          <>
            <SectionHeading title="Holdings" className="pt-1" />
            {loading ? (
              <View accessibilityLabel="Loading holdings" className="gap-2">
                <RowSkeleton />
                <RowSkeleton />
              </View>
            ) : store.stockPositions.length === 0 ? (
              <Text className="px-1 font-body text-body-sm text-slate">You don&apos;t hold any shares yet.</Text>
            ) : (
              <View className="gap-2">
                {store.stockPositions.map((position) => (
                  <HoldingRow
                    key={position.symbol}
                    position={position}
                    onPress={() => router.push({ pathname: '/grow/stock/[symbol]', params: { symbol: position.symbol } })}
                  />
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
              <View accessibilityLabel="Searching" className="mt-3 gap-2">
                <RowSkeleton />
                <RowSkeleton />
                <RowSkeleton />
              </View>
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
                      <View className="min-w-0 flex-1 pr-3">
                        <Text numberOfLines={1} className="font-strong text-body-sm text-ink">
                          {result.name}
                        </Text>
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
