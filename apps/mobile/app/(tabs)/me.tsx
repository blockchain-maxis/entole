import { View, Text } from 'react-native';
import { Screen } from '@/components/ui/Screen';

export default function Me() {
  return (
    <Screen edges={{ bottom: false }}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text>Me</Text>
      </View>
    </Screen>
  );
}
