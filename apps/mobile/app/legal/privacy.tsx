import { ScrollView } from 'react-native';

import { Header } from '@/components/ui/Header';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';

/** Placeholder — a real privacy notice needs legal review before ship. */
export default function Privacy() {
  return (
    <Screen>
      <Header title="Privacy" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}>
        <Text className="font-body text-body-sm text-slate">
          Placeholder — Entole&apos;s privacy notice goes here once written and reviewed. Nothing
          on this screen is a real legal document yet.
        </Text>
      </ScrollView>
    </Screen>
  );
}
