import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ApiClientError, getBootstrap } from '@/lib/bootstrap';
import { getPlatformTenants } from '@/lib/platform';
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
    // D-21/D-23: the platform host is authorised by the API, never by claims. A 200 from
    // `/v1/platform/tenants` IS the proof this session is a platform_admin on the right host; a member
    // (403 FORBIDDEN) or a platform session that wandered onto a tenant host (403 TENANT_HOST_MISMATCH)
    // is signed out by the same route handler the tenant branch uses, and sees no tenant details.
    try {
      await getPlatformTenants();
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.status === 401) redirect('/entrar');
        if (error.code === 'FORBIDDEN' || error.code === 'TENANT_HOST_MISMATCH') {
          redirect('/auth/host-mismatch');
        }
      }
      throw error;
    }
    return (
      <>
        <TopBar label={tp('title')} logoutLabel={t('logout')} />
        <main style={{ padding: '1rem' }}>{children}</main>
      </>
    );
  }

  let tenantName: string;
  try {
    tenantName = (await getBootstrap()).tenant.displayName;
  } catch (error) {
    // The layout is a Server Component, so it cannot clear cookies itself: each 403 is routed to a
    // Route Handler under /auth/* that signs the device out and then lands on the public screen.
    if (error instanceof ApiClientError) {
      // Expired/invalid session between proxy.ts and the API: back to login.
      if (error.status === 401) redirect('/entrar');

      switch (error.code) {
        // AUTH-06 / D-09: the block takes effect on the very next request. The tenant display name is
        // the only detail the 403 carries and the only one the screen shows.
        case 'MEMBERSHIP_BLOCKED': {
          const tenant = String(error.details?.tenantName ?? '');
          redirect(`/auth/blocked?t=${encodeURIComponent(tenant)}`);
          break;
        }
        // TENANT-01 / D-23: no query parameters — the screen must not name either tenant.
        case 'TENANT_HOST_MISMATCH':
          redirect('/auth/host-mismatch');
          break;
        // Orphan identity: a session with no membership row.
        case 'NO_MEMBERSHIP':
          redirect('/sem-comunidade');
          break;
        default:
          break;
      }
    }
    throw error;
  }

  return (
    <>
      <TopBar label={tenantName} logoutLabel={t('logout')} />
      <main style={{ padding: '1rem' }}>{children}</main>
    </>
  );
}
