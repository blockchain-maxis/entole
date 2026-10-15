import { useState } from 'react';
import { View } from 'react-native';

import { useStore } from '@entole/core/store';

import { Button } from './Button';
import { Text } from './Text';

/**
 * Said once, after the allowance rules moved to their new home on the
 * network, where the undo window is held by the network itself. Allowances
 * written before that no longer pay and are shown stopped; what they could
 * still draw is cleared here, with one tap, and they are written again.
 * Mirrors `apps/web/components/OldAllowancesNotice.tsx`.
 */
export function OldAllowancesNotice() {
  const store = useStore();
  const [clearing, setClearing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!store.oldPolicyApproval) return null;

  async function clear() {
    if (clearing) return;
    setClearing(true);
    setProblem(null);
    try {
      await store.clearOldApprovals();
    } catch {
      setProblem("That didn't go through. Nothing changed. Try again.");
    } finally {
      setClearing(false);
    }
  }

  return (
    <View accessibilityRole="summary" className="mb-4 border-y border-hairline py-4">
      <Text className="font-strong text-ui text-ink">Allowances need writing again</Text>
      <Text className="mt-1 font-body text-note text-slate">
        The wait before the assistant pays is now kept by the network itself. Allowances written before that are
        stopped. Clear what they could still draw, then write the ones you want again.
      </Text>
      {problem ? <Text className="mt-2 font-body text-note text-halt">{problem}</Text> : null}
      <View className="mt-3 flex-row">
        <Button
          label={clearing ? 'Clearing' : 'Clear the old ones'}
          width="hug"
          busy={clearing}
          onPress={() => void clear()}
        />
      </View>
    </View>
  );
}
