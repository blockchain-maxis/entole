import { useRouter } from 'expo-router';
import { ChevronRight, Sprout, TrendingUp } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';

import { Header } from '@/components/ui/Header';
import { PauseButton } from '@/components/ui/PauseButton';
import { Screen } from '@/components/ui/Screen';
import { BalanceSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';
import { useThemeColors } from '@/lib/theme';

/**
 * The Grow hub — two products, each a card into its own flow. Savings is the
 * owner's own balance growing; Stocks is buying and selling shares. Neither
 * moves anything from here — every action lives one tap in.
 */
export default function Grow() {
  const router = useRouter();
  const store = useStore();
  const colors = useThemeColors();
  const loading = store.status === 'loading';
  const savings = store.growPosition;

  const holdingsValue = store.stockPositions.reduce((sum, p) => sum + p.currentValueMinor, 0);

  return (
    <Screen edges={{ bottom: false }}>
      <Header title="Grow" trailing={<PauseButton />} />

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        {loading || !savings ? (
          <BalanceSkeleton />
        ) : (
          <View className="gap-3">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Savings"
              onPress={() => router.push('/grow/savings')}
              className="rounded-panel bg-card p-5 shadow-raised"
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2.5">
                  <Sprout size={20} strokeWidth={1.5} color={colors.settled.DEFAULT} />
                  <Text className="font-heavy text-body text-ink">Savings</Text>
                </View>
                <ChevronRight size={18} strokeWidth={1.5} color={colors.mist} />
              </View>
              <Text tabular className="mt-4 font-heavy text-amount text-ink">
                {formatNaira(kobo(savings.balanceMinor))}
              </Text>
              <Text className="mt-1 font-body text-label-sm text-slate">
                {savings.accruedMinor > 0
                  ? `+ ${formatNaira(kobo(savings.accruedMinor))} earned so far`
                  : 'Put money aside and watch it grow.'}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stocks"
              onPress={() => router.push('/grow/stocks')}
              className="rounded-panel border border-line bg-card p-5"
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2.5">
                  <TrendingUp size={20} strokeWidth={1.5} color={colors.indigo.DEFAULT} />
                  <Text className="font-heavy text-body text-ink">Stocks</Text>
                </View>
                <ChevronRight size={18} strokeWidth={1.5} color={colors.mist} />
              </View>
              {store.stocksAvailable ? (
                <>
                  <Text tabular className="mt-4 font-heavy text-amount text-ink">
                    {formatNaira(kobo(holdingsValue))}
                  </Text>
                  <Text className="mt-1 font-body text-label-sm text-slate">
                    {store.stockPositions.length > 0
                      ? `${store.stockPositions.length} ${store.stockPositions.length === 1 ? 'holding' : 'holdings'}`
                      : 'Buy your first share.'}
                  </Text>
                </>
              ) : (
                <Text className="mt-3 font-body text-label-sm text-slate">Not available yet.</Text>
              )}
            </Pressable>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
