import { View, Text } from 'react-native';
import { Screen } from '@/components/ui/Screen';

export default function Lifestyle() {
  return (
    <Screen edges={{ bottom: false }}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text>Lifestyle</Text>
      </View>
    </Screen>
  );
}
