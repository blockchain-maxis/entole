import { ScrollView } from 'react-native';

import { Header } from '@/components/ui/Header';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';

/** Placeholder — real terms of service need legal review before ship. */
export default function Terms() {
  return (
    <Screen>
      <Header title="Terms" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}>
        <Text className="font-body text-body-sm text-slate">
          Placeholder — Entole&apos;s terms of service go here once written and reviewed. Nothing
          on this screen is a real legal document yet.
        </Text>
      </ScrollView>
    </Screen>
  );
}
