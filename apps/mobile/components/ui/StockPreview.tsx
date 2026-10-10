import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';

import { toNaira } from '@entole/core/fx';
import { cents, formatNaira } from '@entole/core/money';
import { useStockDetail } from '@entole/core/stock-browse';
import { formatBig, formatChange, formatUsd, type StockDetail } from '@entole/core/stock-market';
import {
  changeTone,
  formatPercent,
  formatStockDay,
  historyChange,
  historyLine,
  stockByline,
  tradingStatus,
} from '@entole/core/stock-view';
import { useStore } from '@entole/core/store';

import { stockMarket } from '@/lib/stocks';
import { useThemeColors } from '@/lib/theme';

import { Button } from './Button';
import { Skeleton } from './Skeleton';
import { StockLogo } from './StockLogo';
import { Text } from './Text';

const TONE = { up: 'text-settled', down: 'text-halt', flat: 'text-slate' } as const;
const CHART_HEIGHT = 96;
/** A few lines fit as they are; anything longer folds behind "Read more". */
const ABOUT_FOLDS_AT = 220;

/**
 * One stock, to look at: its price and how it moved, a month of closes, how
 * much of it was traded, what the company is worth, its range over a year and
 * a few lines about it. Every figure is read live through `stockMarket`; if it
 * cannot be read the screen says so and shows no figure at all.
 *
 * Buying is not open, so the one action is a button that cannot be pressed.
 * Nothing on this screen can move money.
 */
export function StockPreview({ symbol }: { symbol: string }) {
  const store = useStore();
  const look = useStockDetail(stockMarket, symbol);
  const detail = look.detail;

  if (look.state === 'loading') {
    return (
      <View accessibilityLabel="Getting the latest price" className="px-1 pt-1">
        <View className="flex-row items-center gap-3">
          <Skeleton className="h-[52px] w-[52px] rounded-pill" />
          <View className="flex-1">
            <Skeleton className="h-4 w-44 rounded-md" />
            <Skeleton className="mt-2 h-3 w-28 rounded-md" />
          </View>
        </View>
        <Skeleton className="mt-7 h-[42px] w-48 rounded-chip" />
        <Skeleton className="mt-3 h-4 w-40 rounded-md" />
        <Skeleton className="mt-6 h-32 w-full rounded-card" />
        <View className="mt-3 flex-row gap-3">
          <Skeleton className="h-[84px] flex-1 rounded-row" />
          <Skeleton className="h-[84px] flex-1 rounded-row" />
        </View>
      </View>
    );
  }

  if (!detail) {
    return (
      <View className="rounded-panel border border-line bg-card p-5">
        <Text className="font-heavy text-body text-ink">We can&apos;t show this stock right now</Text>
        <Text className="mt-2 font-body text-body-sm text-slate">
          Its price is read live from the market, and it could not be reached just now. Nothing has changed.
        </Text>
        <View className="mt-4 flex-row">
          <Button label="Try again" variant="secondary" width="hug" onPress={look.retry} />
        </View>
      </View>
    );
  }

  return (
    <StockFacts
      detail={detail}
      nairaPrice={store.status === 'ready' ? formatNaira(toNaira(cents(detail.priceCents), store.rate)) : null}
    />
  );
}

function StockFacts({ detail, nairaPrice }: { detail: StockDetail; nairaPrice: string | null }) {
  const colors = useThemeColors();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [chartWidth, setChartWidth] = useState(0);
  const aboutFolds = (detail.about?.length ?? 0) > ABOUT_FOLDS_AT;
  const month = historyChange(detail.history);
  const line = chartWidth > 0 ? historyLine(detail.history, chartWidth, CHART_HEIGHT, 4) : null;
  const lineColor = { up: colors.settled.DEFAULT, down: colors.halt.DEFAULT, flat: colors.slate }[changeTone(month?.changeBps ?? 0)];

  const facts: { label: string; value: string; note?: string }[] = [];
  if (detail.volume !== undefined) {
    facts.push({
      label: 'Shares traded',
      value: formatBig(detail.volume),
      ...(detail.averageVolume ? { note: `Usually ${formatBig(detail.averageVolume)}` } : {}),
    });
  }
  if (detail.marketCap) {
    facts.push({ label: detail.kind === 'fund' ? 'Fund size' : 'Company value', value: `$${formatBig(detail.marketCap)}` });
  }
  if (detail.yearLowCents && detail.yearHighCents) {
    facts.push({ label: 'Lowest in a year', value: formatUsd(detail.yearLowCents) });
    facts.push({ label: 'Highest in a year', value: formatUsd(detail.yearHighCents) });
  }
  if (detail.previousCloseCents) facts.push({ label: 'Price the day before', value: formatUsd(detail.previousCloseCents) });
  if (detail.dividendYieldBps) {
    facts.push({ label: 'Paid to owners', value: `${formatPercent(detail.dividendYieldBps)} a year`, note: 'As dividends' });
  }
  // Two to a row; a last one on its own takes the whole row.
  const rows: (typeof facts)[] = [];
  for (let index = 0; index < facts.length; index += 2) rows.push(facts.slice(index, index + 2));

  return (
    <View>
      <View className="flex-row items-center gap-3 px-1 pt-1">
        <StockLogo src={detail.logo} name={detail.name} size={52} />
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="font-heavy text-headline text-ink">
            {detail.name}
          </Text>
          <Text numberOfLines={1} className="font-body text-label-sm text-slate">
            {stockByline(detail)}
          </Text>
        </View>
      </View>

      <View className="px-1 pt-6">
        <Text tabular className="font-heavy text-balance-sm text-ink">
          {formatUsd(detail.priceCents)}
        </Text>
        <Text className="mt-2.5 font-body text-label text-slate">
          <Text tabular className={`font-strong text-label ${TONE[changeTone(detail.changeBps)]}`}>
            {formatChange(detail.changeBps)}
          </Text>
          {detail.asOf ? ` on ${formatStockDay(detail.asOf)}` : ' on its last trading day'}
        </Text>
        {nairaPrice ? (
          <Text tabular className="mt-1 font-body text-label-sm text-slate">
            About {nairaPrice} a share
          </Text>
        ) : null}
      </View>

      {month ? (
        <View className="mt-6 rounded-card border border-line bg-card p-4">
          <View className="flex-row items-baseline justify-between">
            <Text className="font-body text-label-sm text-slate">Since {formatStockDay(month.since)}</Text>
            <Text tabular className={`font-strong text-label ${TONE[changeTone(month.changeBps)]}`}>
              {formatChange(month.changeBps)}
            </Text>
          </View>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`Closing price each day since ${formatStockDay(month.since)}`}
            onLayout={(event) => setChartWidth(Math.round(event.nativeEvent.layout.width))}
            className="mt-3"
            style={{ height: CHART_HEIGHT }}
          >
            {line ? (
              <Svg width={chartWidth} height={CHART_HEIGHT}>
                <Polyline
                  points={line}
                  fill="none"
                  stroke={lineColor}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            ) : null}
          </View>
        </View>
      ) : null}

      {rows.length > 0 ? (
        <View className="mt-3 gap-3">
          {rows.map((pair) => (
            <View key={pair[0]?.label} className="flex-row gap-3">
              {pair.map((fact) => (
                <View key={fact.label} className="flex-1 rounded-row border border-line bg-card px-4 py-3.5">
                  <Text className="font-body text-label-sm text-slate">{fact.label}</Text>
                  <Text tabular className="mt-1 font-strong text-body-lg text-ink">
                    {fact.value}
                  </Text>
                  {fact.note ? (
                    <Text tabular className="mt-0.5 font-body text-label-sm text-slate">
                      {fact.note}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null}

      {detail.about ? (
        <View className="px-1 pt-6">
          <Text className="font-heavy text-body-sm text-ink">About</Text>
          <Text
            {...(aboutFolds && !aboutOpen ? { numberOfLines: 4 } : {})}
            className="mt-2 font-body text-body-sm text-slate"
          >
            {detail.about}
          </Text>
          {aboutFolds ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: aboutOpen }}
              onPress={() => setAboutOpen((open) => !open)}
              className="mt-1.5 self-start"
            >
              <Text className="font-strong text-label-sm text-indigo">{aboutOpen ? 'Show less' : 'Read more'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <Text className="px-1 pt-6 font-body text-label-sm text-slate">{tradingStatus(detail)}</Text>

      <View
        accessible
        accessibilityRole="button"
        accessibilityState={{ disabled: true }}
        accessibilityLabel="Buy, coming soon"
        className="mt-3 h-14 flex-row items-center justify-center gap-2.5 rounded-control bg-press"
      >
        <Text className="font-strong text-body-lg text-mist">Buy</Text>
        <View className="rounded-chip border border-line bg-card px-2 py-0.5">
          <Text className="font-strong text-label-sm text-slate">Coming soon</Text>
        </View>
      </View>
      <Text className="mt-2.5 px-1 text-center font-body text-label-sm text-slate">
        Buying opens soon. Nothing here can move your money yet.
      </Text>
    </View>
  );
}
