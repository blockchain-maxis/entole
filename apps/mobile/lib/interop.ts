import { cssInterop } from 'nativewind';
import Animated from 'react-native-reanimated';

/**
 * Tailwind class names only reach React Native's own components by default.
 * Anything else we style by name has to be registered once, here, so a screen
 * never has to reach for a raw style object to move an animated view.
 */
cssInterop(Animated.View, { className: 'style' });
cssInterop(Animated.Text, { className: 'style' });
cssInterop(Animated.ScrollView, { className: 'style' });

export {};
