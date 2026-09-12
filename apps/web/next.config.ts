import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev server binds one port for every local host: the tenant hosts (`tria-demo.localhost`,
  // `tria-lab.localhost`) and the platform host (`tria.localhost`) must be allowed to load `/_next/*`
  // assets and post server actions (D-20/D-21). Chromium resolves `*.localhost` to loopback (RFC 6761).
  allowedDevOrigins: ['*.localhost'],
};

// next-intl without locale routing: one pt-BR catalog resolved by ./i18n/request.ts.
const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

export default withNextIntl(nextConfig);
