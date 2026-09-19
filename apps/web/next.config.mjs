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
};

export default nextConfig;
