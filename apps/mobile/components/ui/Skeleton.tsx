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
      <Skeleton className="mt-3.5 h-[54px] w-64 rounded-chip" />
      <Skeleton className="mt-3.5 h-4 w-28 rounded-md" />
    </View>
  );
}

export function AllowanceCardSkeleton() {
  return (
    <View className="rounded-row border border-line bg-card px-4 pb-[18px] pt-4">
      <Skeleton className="h-4 w-48 rounded-md" />
      <Skeleton className="mt-3.5 h-6 w-40 rounded-md" />
      <Skeleton className="mt-3.5 h-2 w-full rounded-pill" />
    </View>
  );
}

export function RowSkeleton() {
  return (
    <View className="flex-row items-center gap-3 rounded-row border border-line bg-card px-3.5 py-3">
      <Skeleton className="h-[42px] w-[42px] rounded-pill" />
      <View className="flex-1">
        <Skeleton className="h-4 w-32 rounded-md" />
        <Skeleton className="mt-2 h-3 w-24 rounded-md" />
      </View>
      <Skeleton className="h-4 w-20 rounded-md" />
    </View>
  );
}
