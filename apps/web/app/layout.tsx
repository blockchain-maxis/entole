import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';

import { token } from '@entole/tokens';

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
  description: 'Money that moves the way people already do.',
};

export const viewport: Viewport = {
  themeColor: token.paper,
  width: 'device-width',
  initialScale: 1,
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
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
