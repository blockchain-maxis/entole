/**
 * `@entole/core` and `@entole/tokens` ship TypeScript source rather than a
 * build step, so Next has to compile them like first-party code.
 */
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
