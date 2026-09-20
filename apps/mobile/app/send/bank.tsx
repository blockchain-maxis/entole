import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { UnavailableNote } from '@/components/ui/UnavailableNote';

/**
 * Paying out to a bank account. It does not exist yet, and this screen says so:
 * it takes no amount, no account number and shows no button that pretends to
 * send. Bank payouts open when a payment partner is connected (see
 * docs/BACKLOG.md). Bank details can already be saved on a beneficiary; nothing
 * uses them until then.
 */
export default function SendToBank() {
  const router = useRouter();

  return (
    <Screen>
      <Header title="Send to a bank account" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24 }}
      >
        <UnavailableNote
          title="Bank payouts aren’t available yet"
          body="They open with a payment partner, which we haven’t connected. Nothing can be sent to a bank account from here, and nothing is charged."
        />

        <View className="mt-7">
          <Text className="font-strong text-title text-ink">What you can do now</Text>
          <Text className="mt-2 font-body text-body-sm text-slate">
            Send to someone’s Entole code or link instead. It settles in seconds.
          </Text>
          <Text className="mt-4 font-body text-body-sm text-slate">
            If you know their bank details, you can save them on their beneficiary now. They’ll be used
            here once bank payouts open.
          </Text>
        </View>
      </ScrollView>

      <ActionBar>
        <Button label="Manage beneficiaries" variant="secondary" onPress={() => router.push('/beneficiaries')} />
        <Button label="Send with a code" onPress={() => router.push('/send/pick')} />
      </ActionBar>
    </Screen>
  );
}
