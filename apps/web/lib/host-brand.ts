import {
  type HostTenant as HostTenantFacts,
  type ResolvedBranding,
  resolveBranding,
} from '@rede-social/contracts';
import { getHostTenant, type HostMode, resolveHostTenant } from '@/lib/tenant-host';

/**
 * The brand a PUBLIC page renders for the host it is served on (TENANT-02, D-25):
 * - `tenant` host: the full by-host answer (`tenant`) and its resolved brand;
 * - `platform` / `generic` host: `tenant` null and the platform's neutral brand.
 *
 * `displayName` comes from the proxy headers, so it is known even when the cached lookup happens to
 * be unavailable (`tenant` null on a tenant host — fail-open to the neutral brand, never to another
 * tenant's; the authenticated shell reads bootstrap instead and is unaffected).
 */
export type HostBrand = {
  mode: HostMode;
  host: string;
  displayName: string | null;
  tenant: HostTenantFacts | null;
  branding: ResolvedBranding;
};

/**
 * Layouts and route handlers on public pages. Mode and host come from the headers proxy.ts wrote
 * (`getHostTenant`); on a tenant host the brand comes from `resolveHostTenant` — the SAME module and
 * bounded cache proxy.ts filled a moment ago, so in one instance this is a map hit; on Vercel (proxy
 * and page in separate functions) it is one cached fetch per host per `TTL_HIT_MS`.
 *
 * Never reads the brand from a header (the four `x-tenant-*` headers stay small, T-02-01) and never
 * caches by anything but the normalised host (Pitfall 1).
 */
export async function getHostBrand(): Promise<HostBrand> {
  const shell = await getHostTenant();
  if (shell.mode !== 'tenant') {
    return {
      mode: shell.mode,
      host: shell.host,
      displayName: null,
      tenant: null,
      branding: resolveBranding({}),
    };
  }

  const resolved = await resolveHostTenant(shell.host);
  if (resolved.mode !== 'tenant') {
    return {
      mode: 'tenant',
      host: shell.host,
      displayName: shell.displayName,
      tenant: null,
      branding: resolveBranding({}),
    };
  }

  const { mode: _mode, host: _host, ...tenant } = resolved;
  return {
    mode: 'tenant',
    host: shell.host,
    displayName: tenant.displayName,
    tenant,
    branding: resolveBranding(tenant.branding),
  };
}
