import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { requireBootstrap } from '@/lib/bootstrap';
import { requirePlatformTenants } from '@/lib/platform';
import { getHostTenant } from '@/lib/tenant-host';
import { logout } from './actions';

function TopBar({ label, logoutLabel }: { label: string; logoutLabel: string }) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.75rem 1rem',
        borderBottom: '1px solid #ddd',
      }}
    >
      <strong>{label}</strong>
      <form action={logout}>
        <button type="submit">{logoutLabel}</button>
      </form>
    </header>
  );
}

/**
 * Authenticated shell. proxy.ts already required a verified session; this layout resolves the tenant
 * of record from `GET /v1/me/bootstrap` (never from the host) and renders "Sair" on every page (D-08).
 * On the platform host there is no membership to bootstrap (D-21; 01-06 authorises that branch via
 * `GET /v1/platform/tenants`).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const [hostTenant, t, tp] = await Promise.all([
    getHostTenant(),
    getTranslations('app'),
    getTranslations('platform'),
  ]);

  if (hostTenant.mode === 'platform') {
    // D-21/D-23: authorised by the API, never by claims; refusals redirect (see requirePlatformTenants).
    await requirePlatformTenants();
    return (
      <>
        <TopBar label={tp('title')} logoutLabel={t('logout')} />
        <main style={{ padding: '1rem' }}>{children}</main>
      </>
    );
  }

  // 401/403 refusals (blocked, host mismatch, no membership) redirect — see requireBootstrap.
  const { tenant } = await requireBootstrap();

  return (
    <>
      <TopBar label={tenant.displayName} logoutLabel={t('logout')} />
      <main style={{ padding: '1rem' }}>{children}</main>
    </>
  );
}
