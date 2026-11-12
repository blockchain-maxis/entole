import { Check, X } from 'lucide-react-native';
import { View } from 'react-native';

import type { StatementRead } from '@entole/core/records';
import type { Reconciliation } from '@entole/core/statement';
import { proofLines, type ProofSummary } from '@entole/core/tee-proof';

import { dayWords, naira } from '@/lib/plan-words';
import { useThemeColors } from '@/lib/theme';

import { Text } from './Text';

/**
 * Where the statement was read and what was checked about it, in plain words.
 * Every check has a tick or a cross; if any failed, the panel says plainly
 * that it was not proven. Nothing here is a claim the checks did not make.
 */
export function ProofPanel({ proof }: { proof: ProofSummary }) {
  const colors = useThemeColors();
  const lines = proofLines(proof);

  return (
    <View accessibilityRole="summary">
      <Text className="font-strong text-ui text-ink">
        {proof.proven
          ? 'Read on NEAR AI Cloud in sealed hardware · proof checked'
          : 'Read on NEAR AI Cloud · the proof did not fully check'}
      </Text>
      {!proof.proven ? (
        <Text className="mt-1 font-body text-note text-halt">
          We could not prove every part of how it was read. Treat these figures with care.
        </Text>
      ) : null}
      <View className="mt-2 border-t border-hairline">
        {lines.map((line) => (
          <View
            key={line.id}
            accessible
            accessibilityLabel={`${line.words}: ${line.passed ? 'checked' : 'not confirmed'}`}
            className="flex-row items-center gap-3 border-b border-hairline py-2.5"
          >
            {line.passed ? (
              <Check size={16} strokeWidth={2} color={colors.settled.DEFAULT} />
            ) : (
              <X size={16} strokeWidth={2} color={colors.halt.DEFAULT} />
            )}
            <Text className="flex-1 font-body text-note text-ink">{line.words}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** The same, from what was kept of an earlier reading: whether it was proven, and when. */
export function KeptProofLine({ latest }: { latest: StatementRead }) {
  return (
    <View accessibilityRole="summary">
      <Text className="font-strong text-ui text-ink">
        {latest.proven
          ? 'Read on NEAR AI Cloud in sealed hardware · proof checked'
          : 'Read on NEAR AI Cloud · the proof did not fully check'}
      </Text>
      <Text className="mt-0.5 font-body text-note text-slate">
        {latest.proven
          ? `Checked when it was read, on ${dayWords(latest.at.slice(0, 10))}. Nothing was kept on the reader.`
          : 'We could not prove every part of how it was read. Treat these figures with care.'}
      </Text>
    </View>
  );
}

type BalanceCheck = Pick<Reconciliation, 'status' | 'differenceMinor'>;

/** Whether the statement adds up: opening plus money in, less money out, against its closing figure. */
export function BalanceCheckLine({ check }: { check: BalanceCheck }) {
  const colors = useThemeColors();
  const words =
    check.status === 'balanced'
      ? 'Balanced to the kobo'
      : check.status === 'off'
        ? `Off by ${naira(Math.abs(check.differenceMinor ?? 0))} — a line may be missing; figures may be off`
        : 'No opening or closing figure to check against';
  return (
    <View accessibilityRole="summary" className="flex-row items-start gap-3 py-2.5">
      <View className="pt-0.5">
        {check.status === 'balanced' ? (
          <Check size={16} strokeWidth={2} color={colors.settled.DEFAULT} />
        ) : (
          <X size={16} strokeWidth={2} color={check.status === 'off' ? colors.halt.DEFAULT : colors.slate} />
        )}
      </View>
      <Text className={`flex-1 font-body text-note ${check.status === 'off' ? 'text-halt' : 'text-ink'}`}>{words}</Text>
    </View>
  );
}
