import { Search } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { useStockBrowse } from '@entole/core/stock-browse';
import { formatChange, formatUsd, type StockKind, type StockListItem } from '@entole/core/stock-market';
import { changeTone, stockByline, stockCountLabel } from '@entole/core/stock-view';

import { stockMarket } from '@/lib/stocks';
import { useThemeColors } from '@/lib/theme';

import { Button } from './Button';
import { RowSkeleton } from './Skeleton';
import { StockLogo } from './StockLogo';
import { Text } from './Text';

const FILTERS: { label: string; kind: StockKind | undefined }[] = [
  { label: 'All', kind: undefined },
  { label: 'Companies', kind: 'company' },
  { label: 'Funds', kind: 'fund' },
];

const TONE = { up: 'text-settled', down: 'text-halt', flat: 'text-slate' } as const;

/**
 * Every stock that will be buyable, with its price and how it moved on its
 * last trading day, read live through `stockMarket`. Search, two filters and
 * a page at a time. It is for looking: each row opens the stock, and nothing
 * here can buy one.
 */
export function StockCatalogue({ onOpen }: { onOpen: (symbol: string) => void }) {
  const colors = useThemeColors();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<StockKind | undefined>(undefined);
  const browse = useStockBrowse(stockMarket, { ...(kind ? { kind } : {}), query });

  return (
    <View>
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
          accessibilityLabel="Search stocks"
          className="flex-1 font-body text-body text-ink"
          style={{ padding: 0 }}
        />
      </View>

      <View className="mt-3 flex-row items-center gap-2">
        {FILTERS.map((filter) => {
          const active = filter.kind === kind;
          return (
            <Pressable
              key={filter.label}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setKind(filter.kind)}
              className={`rounded-pill border px-3.5 py-1.5 ${
                active ? 'border-indigo bg-indigo-wash' : 'border-line bg-card active:border-mist'
              }`}
            >
              <Text className={`font-strong text-label-sm ${active ? 'text-indigo' : 'text-slate'}`}>{filter.label}</Text>
            </Pressable>
          );
        })}
        {browse.state === 'ready' && browse.total > 0 ? (
          <Text tabular className="ml-auto font-body text-label-sm text-slate">
            {stockCountLabel(browse.total, kind)}
          </Text>
        ) : null}
      </View>

      <View className="mt-4">
        {browse.state === 'loading' ? (
          <View accessibilityLabel="Loading stocks" className="gap-2">
            {Array.from({ length: 7 }, (_, index) => (
              <RowSkeleton key={index} />
            ))}
          </View>
        ) : browse.state === 'failed' ? (
          <View className="rounded-panel border border-line bg-card p-5">
            <Text className="font-heavy text-body text-ink">We can&apos;t show stocks right now</Text>
            <Text className="mt-2 font-body text-body-sm text-slate">
              Prices are read live from the market, and it could not be reached just now. Nothing has changed.
            </Text>
            <View className="mt-4 flex-row">
              <Button label="Try again" variant="secondary" width="hug" onPress={browse.retry} />
            </View>
          </View>
        ) : browse.items.length === 0 ? (
          <View className="px-1 pt-2">
            <Text className="font-strong text-body-sm text-ink">Nothing matches that search</Text>
            <Text className="mt-1 font-body text-label-sm text-slate">Try the company&apos;s name, or its symbol.</Text>
          </View>
        ) : (
          <>
            <View className="gap-2">
              {browse.items.map((item) => (
                <StockRow key={item.symbol} item={item} onPress={() => onOpen(item.symbol)} />
              ))}
            </View>

            {browse.loadingMore ? (
              <View accessibilityLabel="Loading more stocks" className="mt-2 gap-2">
                <RowSkeleton />
                <RowSkeleton />
              </View>
            ) : browse.hasMore ? (
              <>
                {browse.moreFailed ? (
                  <Text className="mt-3 px-1 font-body text-label-sm text-halt">The next ones could not be loaded.</Text>
                ) : null}
                <View className="mt-3 flex-row">
                  <Button
                    label={browse.moreFailed ? 'Try again' : 'Show more'}
                    variant="secondary"
                    onPress={browse.loadMore}
                  />
                </View>
              </>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

function StockRow({ item, onPress }: { item: StockListItem; onPress: () => void }) {
  const price = formatUsd(item.priceCents);
  const change = formatChange(item.changeBps);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${price}, ${change}`}
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-row border border-line bg-card px-3.5 py-3 active:border-mist"
    >
      <StockLogo src={item.logo} name={item.name} />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="font-strong text-body-sm text-ink">
          {item.name}
        </Text>
        <Text numberOfLines={1} className="font-body text-label-sm text-slate">
          {stockByline(item)}
        </Text>
      </View>
      <View className="items-end">
        <Text tabular className="font-strong text-body-sm text-ink">
          {price}
        </Text>
        <Text tabular className={`font-body text-label-sm ${TONE[changeTone(item.changeBps)]}`}>
          {change}
        </Text>
      </View>
    </Pressable>
  );
}
