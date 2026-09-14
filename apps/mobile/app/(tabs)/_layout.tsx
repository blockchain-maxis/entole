import { createMaterialTopTabNavigator } from 'expo-router/js-top-tabs';
import { withLayoutContext } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TopTabs = createMaterialTopTabNavigator().Navigator;
const MaterialTopTabs = withLayoutContext(TopTabs);

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <MaterialTopTabs
      tabBarPosition="bottom"
      screenOptions={{
        tabBarActiveTintColor: '#000',
        tabBarInactiveTintColor: '#888',
        tabBarIndicatorStyle: {
          backgroundColor: '#000',
          height: 3,
          position: 'absolute',
          top: 0,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          textTransform: 'capitalize',
          fontWeight: 'bold',
        },
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopWidth: 1,
          borderTopColor: '#eee',
          paddingBottom: insets.bottom,
          height: 50 + insets.bottom,
        },
        tabBarItemStyle: {
          height: 50,
          justifyContent: 'center',
        },
      }}
    >
      <MaterialTopTabs.Screen
        name="index"
        options={{ title: 'Home' }}
      />
      <MaterialTopTabs.Screen
        name="transfer"
        options={{ title: 'Transfer' }}
      />
      <MaterialTopTabs.Screen
        name="lifestyle"
        options={{ title: 'Lifestyle' }}
      />
      <MaterialTopTabs.Screen
        name="invest"
        options={{ title: 'Invest' }}
      />
      <MaterialTopTabs.Screen
        name="me"
        options={{ title: 'Me' }}
      />
    </MaterialTopTabs>
  );
}
