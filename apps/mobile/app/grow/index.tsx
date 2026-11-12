import { Redirect } from 'expo-router';

/**
 * Grow was a tab of its own; its savings and stocks now live on Money. A link
 * that still says /grow lands there instead of on nothing.
 */
export default function GrowMovedToMoney() {
  return <Redirect href="/(tabs)/money" />;
}
