import * as fs from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { AppTab } from '@rede-social/contracts/native';
import type { LogoBytes, LogoReader, TenantRecord, TenantSource } from './config';

/**
 * Where the command reads the tenant from and how it fetches the tenant's logo (13-29). The real readers go
 * through the kernel (the platform lane and `readAppTab`); the modules that import them load them lazily, so a
 * unit test that never touches a database never loads the kernel environment.
 */

type Row = Record<string, unknown>;

/** The control plane, read through the platform lane: the mirror's tenant row, its verified hosts and the App tab. */
export const pgTenantSource: TenantSource = {
  async load(slug): Promise<TenantRecord | null> {
    const { withPlatformTx } = await import('@rede-social/core/db/platform-tx');
    const { readAppTab } = await import('@rede-social/core/server/apps/index');
    const { sql } = await import('drizzle-orm');

    const found = await withPlatformTx(async (tx) => {
      const tenants = Array.from(
        await tx.execute<Row>(
          sql`select id::text as id, slug, display_name, branding from public.tenants where slug = ${slug} limit 1`,
        ),
      );
      const tenant = tenants[0];
      if (!tenant) return null;
      const tenantId = String(tenant.id);
      const domains = Array.from(
        await tx.execute<Row>(sql`
          select host, is_primary from public.tenant_domains
           where tenant_id = ${tenantId}::uuid and verified_at is not null
           order by is_primary desc, host asc`),
      );
      const urls = Array.from(
        await tx.execute<Row>(sql`
          select store_url_ios, store_url_android from platform.tenant_apps
           where tenant_id = ${tenantId}::uuid`),
      );
      return { tenant, domains, url: urls[0] };
    });
    if (!found) return null;

    const tenantId = String(found.tenant.id);
    const primary = found.domains.find((row) => row.is_primary === true);
    const tab: AppTab = await readAppTab(tenantId);
    return {
      tenantId,
      slug: String(found.tenant.slug),
      displayName: String(found.tenant.display_name),
      branding: found.tenant.branding,
      primaryHost: primary ? String(primary.host) : null,
      hosts: found.domains.map((row) => String(row.host)),
      tab,
      storeUrls: {
        ios: typeof found.url?.store_url_ios === 'string' ? found.url.store_url_ios : null,
        android:
          typeof found.url?.store_url_android === 'string' ? found.url.store_url_android : null,
      },
    };
  },
};

const LOGO_MAX_BYTES = 5 * 1024 * 1024;

/** A host that can only be a private or loopback target is never fetched from a CI runner. */
function isUnsafeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    host.startsWith('[') ||
    /^\d+(\.\d+){3}$/.test(host)
  );
}

/** The real reader: https only, no redirects, 5 MB cap, a public host name. */
export const httpsLogoReader: LogoReader = async (logoUrl) => {
  const url = new URL(logoUrl);
  if (url.protocol !== 'https:' || isUnsafeHost(url.hostname)) throw new Error('logo_unreadable');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('logo_unreadable');
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > LOGO_MAX_BYTES) throw new Error('logo_unreadable');
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length === 0 || data.length > LOGO_MAX_BYTES) throw new Error('logo_unreadable');
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim();
  return { data, ...(mime ? { mime } : {}) };
};

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/**
 * The dry run's reader: the logo path is looked up under the repository's own `apps/web/public` folder (where the
 * seeded tenants' logos live), never over the network. A path that escapes the folder or a missing file is an error.
 */
export function localLogoReader(publicDir: string): LogoReader {
  return async (logoUrl): Promise<LogoBytes> => {
    const pathname = decodeURIComponent(new URL(logoUrl).pathname);
    const target = resolve(publicDir, `.${pathname}`);
    const inside = relative(resolve(publicDir), target);
    if (
      inside === '' ||
      inside.startsWith('..') ||
      isAbsolute(inside) ||
      inside.split(sep).includes('..')
    ) {
      throw new Error('logo_unreadable');
    }
    const data = await fs.readFile(target);
    const extension = target.slice(target.lastIndexOf('.')).toLowerCase();
    const mime = MIME_BY_EXTENSION[extension];
    return { data, ...(mime ? { mime } : {}) };
  };
}
