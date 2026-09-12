import { z } from 'zod';

/** Header the web BFF forwards to the API with the browser-facing host, already normalised (D-23). */
export const TENANT_HOST_HEADER = 'x-tenant-host';

/**
 * The ONE place hosts are canonicalised: trim, lower-case, strip a trailing `:port`.
 * Returns null for empty input so `TRIA-DEMO.LOCALHOST:3000` and `tria-demo.localhost` share a key everywhere.
 */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let host = raw.trim().toLowerCase();
  if (host.startsWith('[')) {
    // IPv6 literal: keep the bracketed address, drop `:port` after the closing bracket.
    const end = host.indexOf(']');
    host = end === -1 ? host : host.slice(0, end + 1);
  } else {
    const colon = host.indexOf(':');
    if (colon !== -1) host = host.slice(0, colon);
  }
  host = host.replace(/\.+$/, '');
  return host.length === 0 ? null : host;
}

/** Body of `GET /v1/public/tenants/by-host` — exactly these two keys, nothing else (D-20). */
export const hostTenantSchema = z
  .object({
    slug: z.string(),
    displayName: z.string(),
  })
  .strict();
export type HostTenant = z.infer<typeof hostTenantSchema>;
