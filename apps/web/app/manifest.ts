import type { MetadataRoute } from 'next';

import { token } from '@entole/tokens';

/**
 * The web app installs to a home screen and runs without browser chrome, so
 * the phone and the browser stay the same product rather than two of them.
 *
 * Colours come from the token package for the same reason component styles do:
 * there is one source of truth, and the install surface is not an exception.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Entole',
    short_name: 'Entole',
    description: 'Money that moves the way people already do.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'portrait',
    background_color: token.paper,
    theme_color: token.paper,
    categories: ['finance'],
    lang: 'en',
    dir: 'ltr',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Activity',
        short_name: 'Activity',
        description: 'Everything that has moved, newest first.',
        url: '/activity',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
