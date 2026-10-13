import { useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { watermarkToken } from '@entole/tokens';

import { AssistantBadge } from './Badge';
import { BrandGlyph } from './BrandMark';
import { Text } from './Text';

/**
 * The receipt as a slip: the one raised surface on the screen it is on. The
 * same slip the browser draws, and the same one a receipt is shared as a
 * picture of. Top to bottom: the mark, that it was delivered, the amount as
 * the figure, then the facts as ruled rows. Behind all of it the name runs
 * small and many, as the paper's watermark.
 */

/**
 * What sits between one word of the watermark and the next: a wide space and
 * an ordinary one. In the display face that brings a word and its gap to
 * within a hair of `watermarkToken.advance`, so the rows here keep step with
 * the browser's and the picture's without a view for every word.
 */
const BETWEEN = '\u2003 ';

/**
 * The watermark: rows of the name, leaning, every other row half a step
 * along. Rows are plain text in a box that is turned and big enough to still
 * cover the corners; the slip cuts off what falls outside it. Each row is one
 * piece of text, so even a tall slip is a few dozen of them.
 */
function SlipWatermark({ width, height }: { width: number; height: number }) {
  const { word, angle, size, advance, row, opacity } = watermarkToken;
  const side = Math.ceil(Math.hypot(width, height)) + advance;
  const rows = Math.ceil(side / row);
  const line = Array.from({ length: Math.ceil(side / advance) + 2 }, () => word).join(BETWEEN);

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <View
        style={{
          position: 'absolute',
          left: (width - side) / 2,
          top: (height - side) / 2,
          width: side,
          height: side,
          transform: [{ rotate: `${angle}deg` }],
        }}
      >
        {Array.from({ length: rows }, (_, index) => (
          <Text
            key={index}
            numberOfLines={1}
            ellipsizeMode="clip"
            // The paper does not grow with the reading size someone has set; the words on it do.
            allowFontScaling={false}
            className="font-display text-ink"
            style={{
              width: side + advance,
              height: row,
              lineHeight: row,
              fontSize: size,
              opacity,
              marginLeft: index % 2 === 0 ? 0 : -advance / 2,
            }}
          >
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

export function ReceiptSlip({ children }: { children: ReactNode }) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  function measure(event: LayoutChangeEvent) {
    const width = Math.round(event.nativeEvent.layout.width);
    const height = Math.round(event.nativeEvent.layout.height);
    setBox((was) => (was && was.width === width && was.height === height ? was : { width, height }));
  }

  return (
    // The shadow is on the outside view: one that cuts off its contents would cut off its own shadow.
    <View className="rounded-card bg-card shadow-raised">
      <View onLayout={measure} className="overflow-hidden rounded-card border border-line">
        {box ? <SlipWatermark width={box.width} height={box.height} /> : null}
        <View className="px-5 pb-6 pt-5">{children}</View>
      </View>
    </View>
  );
}

/** The slip's letterhead: the mark and the name, and what this piece of paper is. */
export function SlipHead() {
  return (
    <View className="flex-row items-center justify-between gap-4">
      <View className="flex-row items-center gap-2">
        <BrandGlyph size={22} />
        <Text className="font-display text-subhead text-ink">Entole</Text>
      </View>
      <Text accessibilityRole="header" className="font-strong text-note text-slate">
        Receipt
      </Text>
    </View>
  );
}

/**
 * That it was delivered. A slip is only ever drawn for a payment that has
 * been, so this never says anything else. A payment the assistant made is
 * marked as the assistant's, here as everywhere.
 */
export function SlipStatus({ children, byAssistant = false }: { children: ReactNode; byAssistant?: boolean }) {
  return (
    <View className="mt-7 flex-row flex-wrap items-center gap-2">
      <View className="flex-row items-center gap-1.5 rounded-pill bg-settled-wash py-1 pl-2.5 pr-3">
        <View className="h-1.5 w-1.5 rounded-pill bg-settled" />
        <Text tabular className="font-strong text-note text-settled">
          {children}
        </Text>
      </View>
      {byAssistant ? <AssistantBadge label="Assistant" /> : null}
    </View>
  );
}

/** The facts, as ruled rows. */
export function SlipRows({ children }: { children: ReactNode }) {
  return <View className="mt-5">{children}</View>;
}

/** A ruled row: what it is on the left, the fact on the right. */
export function SlipRow({
  label,
  value,
  spaced = false,
}: {
  label: string;
  value: string;
  /** For a reference: a little air between its characters, so it can be read out. */
  spaced?: boolean;
}) {
  return (
    <View className="flex-row items-baseline justify-between gap-4 border-t border-line py-3">
      <Text className="font-body text-ui text-slate">{label}</Text>
      <Text
        tabular
        selectable={spaced}
        className="flex-shrink text-right font-strong text-ui text-ink"
        style={spaced ? { letterSpacing: 0.6 } : undefined}
      >
        {value}
      </Text>
    </View>
  );
}

/** The slip's last line, under a rule. */
export function SlipFoot({ children }: { children: ReactNode }) {
  return (
    <View className="border-t border-line pt-4">
      <Text className="font-body text-note text-slate">{children}</Text>
    </View>
  );
}
