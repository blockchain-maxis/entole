/**
 * The display serif, bundled with the app: headlines, the figure a screen is
 * about, the allowance sentence. The two files and their licence are in
 * `assets/fonts`, so nothing is fetched to draw a headline. The names here are
 * the ones `packages/tokens/tailwind-preset.js` maps `font-display` and
 * `font-display-plain` onto.
 */
export const DISPLAY_FONTS = {
  SourceSerif4_400Regular: require('../assets/fonts/SourceSerif4_400Regular.ttf'),
  SourceSerif4_600SemiBold: require('../assets/fonts/SourceSerif4_600SemiBold.ttf'),
};
