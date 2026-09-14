/**
 * `@entole/core` and `@entole/tokens` ship TypeScript source rather than a
 * build step, so Next has to compile them like first-party code.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@entole/core', '@entole/tokens'],
};

export default nextConfig;
