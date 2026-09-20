import { useRouter, type Href } from 'expo-router';
import { ArrowDownLeft, ChevronRight, Landmark, SendHorizontal, type LucideIcon } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';

import { Header } from '@/components/ui/Header';
import { PauseButton } from '@/components/ui/PauseButton';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useThemeColors } from '@/lib/theme';

type Action = { label: string; caption: string; icon: LucideIcon; href: Href };

/**
 * Everything that moves money out or in. Only what works is listed.
 *
 * Not here on purpose: "Pay a bill" (app/bill) — it needs a bill-payment
 * partner that is not configured, and it never draws on the account balance,
 * so it would only look like a payment. "Send abroad" is gone because it was
 * just Send with the saved people grouped by country; sending to anyone,
 * anywhere, is Send.
 */
const ACTIONS: Action[] = [
  { label: 'Send money', caption: 'To someone’s code or link', icon: SendHorizontal, href: '/send/pick' },
  { label: 'Receive', caption: 'Share your link or QR code', icon: ArrowDownLeft, href: '/receive' },
  { label: 'Send to a bank account', caption: 'Opens with a payment partner soon', icon: Landmark, href: '/send/bank' },
];

function ActionRow({ action, onPress }: { action: Action; onPress: () => void }) {
  const colors = useThemeColors();
  const Icon = action.icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onPress={onPress}
      className="flex-row items-center gap-3.5 rounded-row border border-line bg-card px-4 py-4 active:border-mist"
    >
      <View className="h-11 w-11 items-center justify-center rounded-pill bg-indigo-wash">
        <Icon size={20} strokeWidth={1.5} color={colors.indigo.DEFAULT} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="font-strong text-body text-ink">{action.label}</Text>
        <Text className="mt-0.5 font-body text-caption text-slate">{action.caption}</Text>
      </View>
      <ChevronRight size={16} strokeWidth={1.5} color={colors.mist} />
    </Pressable>
  );
}

export default function Pay() {
  const router = useRouter();

  return (
    <Screen edges={{ bottom: false }}>
      <Header title="Pay" leading="none" trailing={<PauseButton />} />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-2.5">
          {ACTIONS.map((action) => (
            <ActionRow key={action.label} action={action} onPress={() => router.push(action.href)} />
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
