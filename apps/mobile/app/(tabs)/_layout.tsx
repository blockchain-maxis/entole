import { Stack } from 'expo-router';

/**
 * One surface for now. The group exists so the home route keeps its place in
 * the design's route table while the second and third surfaces are built.
 */
export default function HomeLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
