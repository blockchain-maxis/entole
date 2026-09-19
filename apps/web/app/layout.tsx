import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';

import { token } from '@entole/tokens';

import { ServiceWorker } from '@/components/ServiceWorker';
import { BLOCKING_THEME_SCRIPT } from '@/lib/theme';

import './globals.css';
import { Providers } from './providers';

/**
 * The phone app loads four Plus Jakarta Sans weights by name. Here the same
 * four are loaded once and exposed as the variables the Tailwind config maps
 * `font-body`, `font-strong` and `font-heavy` onto.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jakarta',
});

export const metadata: Metadata = {
  title: 'Entole',
  applicationName: 'Entole',
  description: 'Money that moves the way people already do.',
  // `app/manifest.ts` is picked up automatically; the rest is what iOS reads,
  // since Safari installs from these tags rather than from the manifest.
  appleWebApp: {
    capable: true,
    title: 'Entole',
    statusBarStyle: 'default',
  },
  // `favicon.ico` first: it is the only one older Android browsers look for.
  // The SVG is the bolder small cut of the mark, which is what tab strips and
  // bookmark bars actually render.
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '16x16 32x32 48x48' },
      { url: '/icons/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  // Next emits the standardised `mobile-web-app-capable`; iOS before 17.4 only
  // reads the prefixed one, and a lot of the phones this ships to are older.
  other: { 'apple-mobile-web-app-capable': 'yes' },
};

export const viewport: Viewport = {
  themeColor: token.paper,
  width: 'device-width',
  initialScale: 1,
  // Installed, the app owns the whole screen, notch included. Zoom stays on.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={jakarta.variable}
      style={
        {
          '--font-plain': 'var(--font-jakarta)',
          '--font-body': 'var(--font-jakarta)',
          '--font-strong': 'var(--font-jakarta)',
          '--font-heavy': 'var(--font-jakarta)',
        } as React.CSSProperties
      }
    >
      <head>
        {/* Runs before React hydrates — applies `.dark` from the stored
            preference (or the OS preference, for `system`) so a returning
            dark-mode visitor never sees a light flash first. */}
        <script dangerouslySetInnerHTML={{ __html: BLOCKING_THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
        <ServiceWorker />
      </body>
    </html>
  );
}
