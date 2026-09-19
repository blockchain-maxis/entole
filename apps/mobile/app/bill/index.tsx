import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';

import { Header } from '@/components/ui/Header';
import { PauseButton } from '@/components/ui/PauseButton';
import { SectionHeading } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { UnavailableNote } from '@/components/ui/UnavailableNote';
import { BILL_ICONS, billsSetup } from '@/lib/bills';
import { useThemeColors } from '@/lib/theme';
import { BILL_CATEGORIES } from '@entole/core/pay-hub';

export default function PayBill() {
  const router = useRouter();
  const colors = useThemeColors();
  const available = billsSetup() !== null;

  return (
    <Screen>
      <Header title="Pay a bill" trailing={<PauseButton />} />

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        {available ? null : (
          <View className="mb-5">
            <UnavailableNote
              title="Bill payments aren't available yet"
              body="You can look around. Paying switches on once bill payments are set up."
            />
          </View>
        )}

        <SectionHeading title="What are you paying?" />
        <View className="gap-2">
          {BILL_CATEGORIES.map((category) => {
            const Icon = BILL_ICONS[category.id];
            return (
              <Pressable
                key={category.id}
                accessibilityRole="button"
                accessibilityLabel={category.label}
                onPress={() => router.push({ pathname: '/bill/[category]', params: { category: category.id } })}
                className="flex-row items-center gap-3 rounded-row border border-line bg-card px-3.5 py-3 active:border-mist"
              >
                <View className="h-11 w-11 items-center justify-center rounded-pill bg-indigo-wash">
                  <Icon size={20} strokeWidth={1.5} color={colors.indigo.DEFAULT} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="font-strong text-body text-ink">{category.label}</Text>
                  <Text className="mt-0.5 font-body text-caption text-slate">{category.hint}</Text>
                </View>
                <ChevronRight size={16} strokeWidth={1.5} color={colors.mist} />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}
