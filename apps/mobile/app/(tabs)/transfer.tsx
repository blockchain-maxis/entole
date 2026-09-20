import { FlashList } from '@shopify/flash-list';
import { useRouter, type Href } from 'expo-router';
import { ArrowDownLeft, Globe, Receipt, SendHorizontal, type LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { PauseButton } from '@/components/ui/PauseButton';
import { ContactRow, SectionHeading } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useThemeColors } from '@/lib/theme';
import { countryName } from '@entole/core/countries';
import type { Contact } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

type Action = { label: string; caption: string; icon: LucideIcon; href: Href };

const ACTIONS: Action[] = [
  { label: 'Send money', caption: 'To a beneficiary', icon: SendHorizontal, href: '/send/pick' },
  { label: 'Receive', caption: 'Show your payment code', icon: ArrowDownLeft, href: '/receive' },
  { label: 'Pay a bill', caption: 'Power, airtime, TV', icon: Receipt, href: '/bill' },
  { label: 'Send abroad', caption: 'Choose by country', icon: Globe, href: '/abroad' },
];

function ActionCard({ action, onPress }: { action: Action; onPress: () => void }) {
  const colors = useThemeColors();
  const Icon = action.icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onPress={onPress}
      className="w-[48%] rounded-card border border-line bg-card p-4 active:border-mist"
    >
      <View className="h-10 w-10 items-center justify-center rounded-pill bg-indigo-wash">
        <Icon size={20} strokeWidth={1.5} color={colors.indigo.DEFAULT} />
      </View>
      <Text className="mt-3 font-strong text-body text-ink">{action.label}</Text>
      <Text className="mt-0.5 font-body text-caption text-slate">{action.caption}</Text>
    </Pressable>
  );
}

/** Everything you can do with money moving out or in, one tap away. */
export default function Pay() {
  const router = useRouter();
  const store = useStore();
  const loading = store.status === 'loading';

  return (
    <Screen edges={{ bottom: false }}>
      <Header title="Pay" leading="none" trailing={<PauseButton />} />

      <FlashList<Contact>
        data={loading ? [] : store.contacts}
        keyExtractor={(contact) => contact.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
        ItemSeparatorComponent={() => <View className="h-2" />}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <View className="flex-row flex-wrap justify-between gap-y-3 pb-6 pt-1">
              {ACTIONS.map((action) => (
                <ActionCard key={action.label} action={action} onPress={() => router.push(action.href)} />
              ))}
            </View>

            <SectionHeading
              title="Beneficiaries"
              {...(!loading && store.contacts.length > 0
                ? { action: 'Manage', onActionPress: () => router.push('/beneficiaries') }
                : {})}
            />

            {loading ? (
              <View className="gap-2">
                <RowSkeleton />
                <RowSkeleton />
                <RowSkeleton />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loading ? null : (
            <View className="rounded-row border border-line bg-card px-4 pb-4 pt-3.5">
              <Text className="font-strong text-body-sm text-ink">No beneficiaries yet</Text>
              <Text className="mt-1 font-body text-label-sm text-slate">
                Add someone with their payment code, and you can send them money.
              </Text>
              <View className="mt-4 flex-row">
                <Button label="Add a beneficiary" onPress={() => router.push('/beneficiaries/new')} />
              </View>
            </View>
          )
        }
        ListFooterComponent={
          !loading && store.contacts.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/beneficiaries/new')}
              className="mt-3 self-start py-1"
              hitSlop={8}
            >
              <Text className="font-strong text-label text-indigo">Add a beneficiary</Text>
            </Pressable>
          ) : null
        }
        renderItem={({ item }) => {
          const where = countryName(item.place);
          return (
            <ContactRow
              contact={item}
              {...(where ? { caption: where } : {})}
              trailing={<Text className="font-strong text-caption-sm text-indigo">Send</Text>}
              onPress={() => router.push({ pathname: '/send', params: { contactId: item.id } })}
            />
          );
        }}
      />
    </Screen>
  );
}
