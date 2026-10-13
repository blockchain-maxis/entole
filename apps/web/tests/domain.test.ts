import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import nextConfig from '../next.config.mjs';

const ROOT = join(__dirname, '..');
const DOMAIN = 'entole.pro';

/**
 * A passkey belongs to one domain, and the account is the passkey. The browser,
 * the phone app and the files that vouch for the phone app all have to name the
 * same one, or the same person gets different accounts in different places.
 */
describe('the one domain accounts are made on', () => {
  const env = readFileSync(join(ROOT, '.env'), 'utf8');
  const mobile = join(ROOT, '..', 'mobile');

  it('is the passkey domain the browser uses', () => {
    expect(env).toMatch(new RegExp(`^NEXT_PUBLIC_RP_ID=${DOMAIN.replace('.', '\\.')}$`, 'm'));
    expect(readFileSync(join(ROOT, 'lib/session.ts'), 'utf8')).toContain(`NEXT_PUBLIC_RP_ID ?? '${DOMAIN}'`);
  });

  it('is the passkey domain the phone app uses, and where it reaches the server', () => {
    expect(readFileSync(join(mobile, 'lib/session.ts'), 'utf8')).toContain(`EXPO_PUBLIC_RP_ID ?? '${DOMAIN}'`);
    const app = JSON.parse(readFileSync(join(mobile, 'app.json'), 'utf8'));
    expect(app.expo.extra.entole.apiBase).toBe(`https://${DOMAIN}`);
    expect(app.expo.ios.associatedDomains).toEqual([`webcredentials:${DOMAIN}`]);
  });

  it('is where a receipt says it can be checked, and where its link leads', () => {
    expect(readFileSync(join(ROOT, 'lib/site.ts'), 'utf8')).toContain(`export const SITE_ORIGIN = 'https://${DOMAIN}';`);
  });

  it('serves the file that lets the Android app use passkeys made here', () => {
    const links = JSON.parse(readFileSync(join(ROOT, 'public/.well-known/assetlinks.json'), 'utf8'));
    expect(links[0].target.package_name).toBe('to.entole.app');
    expect(links[0].relation).toContain('delegate_permission/common.get_login_creds');
  });

  it('sends anyone at the earlier address on, path and all, without making it permanent', async () => {
    const redirects = await nextConfig.redirects?.();
    expect(redirects).toEqual([
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'entole.vercel.app' }],
        destination: `https://${DOMAIN}/:path*`,
        permanent: false,
      },
    ]);
  });
});
