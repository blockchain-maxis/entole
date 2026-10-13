/**
 * `@entole/core` and `@entole/tokens` ship TypeScript source rather than a
 * build step, so Next has to compile them like first-party code.
 */
/**
 * Sent with every response. The app is never shown inside another site's
 * frame (a payment screen under someone else's page is how a tap gets
 * stolen), is only ever loaded over https, and never has its files guessed at
 * as another type. The camera and the microphone stay available to the app
 * itself, for scanning a code and for talking to the assistant, and to nobody
 * it might embed.
 *
 * The content policy here is the part that cannot break a page: who may frame
 * it, where a form may post, no plugins. It does not yet list which scripts
 * and addresses the app may load, which needs a nonce on every inline script
 * Next writes; see docs/SECURITY.md.
 */
const securityHeaders = [
  // This host only: nothing is promised here on behalf of other names under the domain.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@entole/core', '@entole/tokens'],
  // Lets `pnpm --filter web dev` be reached from another device on the LAN
  // (phone/tablet testing) — add more IPs here as needed.
  allowedDevOrigins: ['10.43.215.204'],
  // The app lives at entole.pro. A passkey belongs to the domain it was made
  // on, so nobody can sign in at the earlier address; it sends them on
  // instead. Temporary (307), so it can be undone without a browser having
  // kept it.
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'entole.vercel.app' }],
        destination: 'https://entole.pro/:path*',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
