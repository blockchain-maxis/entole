import { useRouter, type Href } from 'expo-router';
import { ArrowDownLeft, ChevronRight, Landmark, Plus, type LucideIcon } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';

import { Header } from '@/components/ui/Header';
import { PauseButton } from '@/components/ui/PauseButton';
import { ContactRow, SectionHeading } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { ActivityRowSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { countryName } from '@entole/core/countries';
import { useStore } from '@entole/core/store';
import { useThemeColors } from '@/lib/theme';

type Action = { label: string; caption: string; icon: LucideIcon; href: Href; strong?: boolean };

/**
 * Paying starts from people. Someone new comes in by their code or link; the
 * beneficiaries already saved follow, one tap from the amount. Everything else
 * that moves money sits under that. Only what works is listed.
 *
 * Not here on purpose: "Pay a bill" (app/bill) — it needs a bill-payment
 * partner that is not configured, and it never draws on the account balance,
 * so it would only look like a payment. "Send abroad" is gone because it was
 * just Send with the saved people grouped by country; sending to anyone,
 * anywhere, is Send.
 */
const SOMEONE_NEW: Action = {
  label: 'Someone new',
  caption: 'With their username, number or link',
  icon: Plus,
  href: '/send/pick',
  strong: true,
};

const OTHER_WAYS: Action[] = [
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
      className="flex-row items-center gap-3 border-b border-hairline py-3 active:bg-press"
    >
      <View
        className={`h-[42px] w-[42px] items-center justify-center rounded-pill ${action.strong ? 'bg-ink' : 'bg-press'}`}
      >
        <Icon size={20} strokeWidth={1.6} color={action.strong ? colors.paper : colors.ink} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="font-strong text-ui text-ink">{action.label}</Text>
        <Text className="mt-0.5 font-body text-note text-slate">{action.caption}</Text>
      </View>
      <ChevronRight size={16} strokeWidth={1.5} color={colors.mist} />
    </Pressable>
  );
}

export default function Pay() {
  const router = useRouter();
  const store = useStore();
  const colors = useThemeColors();

  return (
    <Screen edges={{ bottom: false }}>
      <Header title="Pay" leading="none" trailing={<PauseButton />} />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        <Text accessibilityRole="header" className="pb-2 pt-1 font-display text-heading text-ink">
          Who are you paying?
        </Text>

        <ActionRow action={SOMEONE_NEW} onPress={() => router.push(SOMEONE_NEW.href)} />

        {store.status === 'loading' ? (
          <View>
            <ActivityRowSkeleton />
            <ActivityRowSkeleton />
          </View>
        ) : store.status === 'ready' ? (
          store.contacts.map((contact) => {
            const where = countryName(contact.place);
            return (
              <ContactRow
                key={contact.id}
                contact={contact}
                {...(where ? { caption: where } : {})}
                trailing={<ChevronRight size={16} strokeWidth={1.5} color={colors.mist} />}
                onPress={() => router.push({ pathname: '/send', params: { contactId: contact.id } })}
              />
            );
          })
        ) : null}

        <SectionHeading title="Other ways" />
        {OTHER_WAYS.map((action) => (
          <ActionRow key={action.label} action={action} onPress={() => router.push(action.href)} />
        ))}
      </ScrollView>
    </Screen>
  );
}
