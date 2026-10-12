import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

/** Loading is a skeleton of the thing that is coming, never a spinner. */
export function Skeleton({ className }: { className: string }) {
  const pulse = useSharedValue(0.55);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return <Animated.View accessibilityRole="progressbar" className={`bg-track ${className}`} style={style} />;
}

export function BalanceSkeleton() {
  return (
    <View className="px-1 pb-[34px] pt-[22px]">
      <Skeleton className="h-4 w-36 rounded-md" />
      <Skeleton className="mt-3.5 h-[54px] w-64 rounded-control" />
      <Skeleton className="mt-3.5 h-4 w-28 rounded-md" />
    </View>
  );
}

export function AllowanceCardSkeleton() {
  return (
    <View className="rounded-card border border-line bg-card px-4 pb-[18px] pt-4">
      <Skeleton className="h-4 w-48 rounded-md" />
      <Skeleton className="mt-3.5 h-6 w-40 rounded-md" />
      <Skeleton className="mt-3.5 h-2 w-full rounded-pill" />
    </View>
  );
}

/** A ruled row, like the rows it stands in for. It was a bordered box from
 * before lists were ruled, and a loading list did not look like the list. */
export function RowSkeleton() {
  return (
    <View className="flex-row items-center gap-3 border-b border-hairline py-3">
      <Skeleton className="h-[42px] w-[42px] rounded-pill" />
      <View className="flex-1">
        <Skeleton className="h-4 w-32 rounded-md" />
        <Skeleton className="mt-2 h-3 w-24 rounded-md" />
      </View>
      <Skeleton className="h-4 w-20 rounded-md" />
    </View>
  );
}

/** The figure a screen is about, before it is known. Never a zero. */
export function FigureSkeleton() {
  return (
    <View className="pt-1.5">
      <Skeleton className="h-[60px] w-56 rounded-control" />
      <Skeleton className="mt-3 h-4 w-40 rounded-md" />
    </View>
  );
}

/** An allowance as it sits on paper: a sentence, what is left, the meter. */
export function AllowanceRowSkeleton({ ruled = false }: { ruled?: boolean }) {
  return (
    <View className={`py-4 ${ruled ? 'border-t border-hairline' : ''}`}>
      <Skeleton className="h-5 w-56 rounded-md" />
      <Skeleton className="mt-3 h-4 w-40 rounded-md" />
      <Skeleton className="mt-3 h-2 w-full rounded-pill" />
    </View>
  );
}

/** A row of the feed on paper, without the box the older rows have. */
export function ActivityRowSkeleton() {
  return (
    <View className="flex-row items-center gap-3 py-3">
      <Skeleton className="h-[42px] w-[42px] rounded-pill" />
      <View className="flex-1">
        <Skeleton className="h-4 w-32 rounded-md" />
        <Skeleton className="mt-2 h-3 w-24 rounded-md" />
      </View>
      <Skeleton className="h-4 w-20 rounded-md" />
    </View>
  );
}

const STOCK_NAME_WIDTHS = ['w-36', 'w-28', 'w-44', 'w-32', 'w-40'] as const;

/** A stock before its price is known: a logo, a name over a symbol, and a
 * price over a change, on a ruled line. Names differ in length, so a list of
 * these does not read as one bar repeated. */
export function StockRowSkeleton({ index = 0 }: { index?: number }) {
  return (
    <View className="flex-row items-center gap-3 border-b border-hairline py-3">
      <Skeleton className="h-10 w-10 rounded-pill" />
      <View className="min-w-0 flex-1">
        <Skeleton className={`h-4 rounded-md ${STOCK_NAME_WIDTHS[index % STOCK_NAME_WIDTHS.length]}`} />
        <Skeleton className="mt-2 h-3 w-14 rounded-md" />
      </View>
      <View className="items-end">
        <Skeleton className="h-4 w-20 rounded-md" />
        <Skeleton className="mt-2 h-3 w-12 rounded-md" />
      </View>
    </View>
  );
}

