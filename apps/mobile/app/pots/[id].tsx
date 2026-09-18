import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Amount } from '@/components/ui/Amount';
import { Avatar } from '@/components/ui/Avatar';
import { SettledBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { Meter } from '@/components/ui/Meter';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { formatNaira, kobo, remaining } from '@entole/core/money';
import type { PotMember } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

/**
 * Shared money with a terminal state. The pot fills, balances resolve, and it
 * settles to zero.
 */
export default function GroupPot() {
  const router = useRouter();
  const store = useStore();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pot = store.pot(id);
  const [settling, setSettling] = useState(false);

  async function settleShare() {
    if (settling) return;
    setSettling(true);
    try {
      await store.settlePotShare(id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setSettling(false);
    }
  }

  if (!pot) {
    return (
      <Screen>
        <Header title="Pot" />
        <View className="flex-1 items-center justify-center px-gutter">
          <Text className="text-center font-body text-body-sm text-slate">
            That pot has settled and closed.
          </Text>
        </View>
      </Screen>
    );
  }

  const target = kobo(pot.targetMinor);
  const collected = kobo(pot.collectedMinor);
  const outstanding = remaining(target, collected);
  const share = Math.round(pot.targetMinor / pot.members.length);
  const fraction = pot.targetMinor > 0 ? pot.collectedMinor / pot.targetMinor : 0;
  const you = pot.members.find((member) => member.isYou);
  const youOwe = you?.owedMinor ?? 0;

  return (
    <Screen>
      <Header title={pot.name} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
      >
        <View className="rounded-card border border-line bg-card px-gutter py-[22px]">
          <Text className="font-strong text-label-sm text-mist">In the pot</Text>
          <View className="mt-2">
            <Amount value={collected} size="medium" />
          </View>
          <Text tabular className="mt-2.5 font-body text-label text-slate">
            of {formatNaira(target)} · {formatNaira(outstanding)} still owed
          </Text>

          <View className="mt-4">
            <Meter fraction={fraction} tone="settled" size="lg" label={`${pot.name} collected`} />
          </View>

          <View className="mt-4 flex-row items-center">
            {pot.members.map((member, index) => (
              <View key={member.id} style={index === 0 ? undefined : { marginLeft: -9 }}>
                <Avatar initials={member.initials.slice(0, 1)} tone={member.tone} size="sm" stacked />
              </View>
            ))}
            <Text className="ml-3 font-body text-label-sm text-slate">
              {pot.members.length} people · started by {pot.startedByYou ? 'you' : 'someone else'}
            </Text>
          </View>
        </View>

        <Text className="px-1 pb-3 pt-[26px] font-heavy text-body-sm text-ink">Who’s in</Text>

        <View className="gap-2">
          {pot.members.map((member) => (
            <MemberRow key={member.id} member={member} share={share} />
          ))}
        </View>

        {pot.assistantNote ? (
          <View className="mt-5 flex-row gap-3 rounded-row bg-indigo-wash px-4 py-4">
            <Text className="flex-none pt-px font-heavy text-badge uppercase text-indigo">Entole</Text>
            <Text className="flex-1 font-body text-label-sm text-ink">{pot.assistantNote}</Text>
          </View>
        ) : null}
      </ScrollView>

      <ActionBar>
        <Button
          label={settling ? 'Settling' : youOwe > 0 ? `Settle ${formatNaira(kobo(youOwe))}` : 'You’re settled'}
          busy={settling}
          disabled={youOwe === 0}
          onPress={() => void settleShare()}
        />
        <Button label="Invite" variant="secondary" width="hug" onPress={() => router.push('/send/pick')} />
      </ActionBar>
    </Screen>
  );
}

function MemberRow({ member, share }: { member: PotMember; share: number }) {
  const settled = member.owedMinor === 0;
  const tone = settled
    ? 'text-settled'
    : member.owedMinor <= share / 2
      ? 'text-caution'
      : 'text-halt';

  return (
    <View className="flex-row items-center gap-3 rounded-row border border-line bg-card px-3.5 py-3.5">
      <Avatar initials={member.initials} tone={member.tone} size="lg" />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text className="font-strong text-body text-ink">{member.name}</Text>
          {settled ? <SettledBadge>Settled</SettledBadge> : null}
        </View>
        <Text tabular className="mt-0.5 font-body text-caption text-slate">
          Paid {formatNaira(kobo(member.paidMinor))}
        </Text>
      </View>
      <Text tabular className={`font-strong text-body-sm ${tone}`}>
        {settled ? 'Settled' : `Owes ${formatNaira(kobo(member.owedMinor))}`}
      </Text>
    </View>
  );
}
