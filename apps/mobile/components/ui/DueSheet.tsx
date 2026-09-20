import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { calendarWeeks, dueDateLabel, dueInDays, endOfLocalDay, monthLabel } from '@entole/core/invoices';

import { useThemeColors } from '@/lib/theme';

import { Button } from './Button';
import { Sheet, SheetLayer } from './Sheet';
import { Text } from './Text';

export type DueChoice = { kind: 'days'; days: number } | { kind: 'date' };

const OPTIONS = [7, 14, 30] as const;
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** What a due date says on the row that opens this sheet. */
export function dueSummary(choice: DueChoice, iso: string): string {
  return choice.kind === 'days' ? `In ${choice.days} days · ${dueDateLabel(iso)}` : dueDateLabel(iso);
}

/**
 * When an invoice falls due, in plain choices — a week, two weeks, a month — or
 * a date picked from a small calendar. No native date picker: a bottom sheet
 * with a month grid, Monday first, and no way to choose a day that has passed.
 */
export function DueSheet({
  onPick,
  onDismiss,
}: {
  onPick: (iso: string, choice: DueChoice) => void;
  onDismiss: () => void;
}) {
  const colors = useThemeColors();
  const today = new Date();
  const [calendar, setCalendar] = useState(false);
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });

  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const onCurrentMonth = cursor.year === today.getFullYear() && cursor.month === today.getMonth();

  function step(direction: -1 | 1) {
    setCursor((current) => {
      const next = new Date(current.year, current.month + direction, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  return (
    <SheetLayer>
      <Sheet onDismiss={onDismiss} handleOnly>
        <Text className="font-strong text-title text-ink">When is it due?</Text>

        {calendar ? (
          <View className="mt-4">
            <View className="flex-row items-center justify-between px-1">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Earlier month"
                disabled={onCurrentMonth}
                hitSlop={12}
                onPress={() => step(-1)}
                className={onCurrentMonth ? 'opacity-30' : ''}
              >
                <ChevronLeft size={22} strokeWidth={1.5} color={colors.slate} />
              </Pressable>
              <Text className="font-strong text-body text-ink">{monthLabel(cursor.year, cursor.month)}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Later month" hitSlop={12} onPress={() => step(1)}>
                <ChevronRight size={22} strokeWidth={1.5} color={colors.slate} />
              </Pressable>
            </View>

            <View className="mt-3 flex-row">
              {WEEKDAYS.map((day, index) => (
                <View key={index} className="flex-1 items-center py-1">
                  <Text className="font-strong text-caption text-mist">{day}</Text>
                </View>
              ))}
            </View>

            {calendarWeeks(cursor.year, cursor.month).map((week, weekIndex) => (
              <View key={weekIndex} className="flex-row">
                {week.map((day, dayIndex) => {
                  const past =
                    day !== null && new Date(cursor.year, cursor.month, day).getTime() < startOfToday;
                  return (
                    <View key={dayIndex} className="flex-1 items-center py-0.5">
                      {day === null ? null : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={dueDateLabel(new Date(cursor.year, cursor.month, day).toISOString())}
                          disabled={past}
                          onPress={() =>
                            onPick(endOfLocalDay(new Date(cursor.year, cursor.month, day)).toISOString(), { kind: 'date' })
                          }
                          className={`h-10 w-10 items-center justify-center rounded-pill ${past ? 'opacity-30' : 'active:bg-press'}`}
                        >
                          <Text tabular className="font-body text-body-sm text-ink">
                            {day}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}

            <View className="mt-3 flex-row">
              <Button label="Back to quick choices" variant="quiet" onPress={() => setCalendar(false)} />
            </View>
          </View>
        ) : (
          <View className="mt-4 gap-2">
            {OPTIONS.map((days) => (
              <Pressable
                key={days}
                accessibilityRole="button"
                onPress={() => onPick(dueInDays(days), { kind: 'days', days })}
                className="flex-row items-center justify-between rounded-chip border border-hairline bg-paper px-4 py-3.5 active:border-mist"
              >
                <Text className="font-strong text-body text-ink">In {days} days</Text>
                <Text tabular className="font-body text-caption text-slate">
                  {dueDateLabel(dueInDays(days))}
                </Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => setCalendar(true)}
              className="flex-row items-center justify-between rounded-chip border border-hairline bg-paper px-4 py-3.5 active:border-mist"
            >
              <Text className="font-strong text-body text-ink">Pick a date</Text>
              <ChevronRight size={18} strokeWidth={1.5} color={colors.mist} />
            </Pressable>
          </View>
        )}
      </Sheet>
    </SheetLayer>
  );
}
