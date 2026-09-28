import {
  type PlatformTenantDetail,
  type PlatformTenants,
  type PlatformTenantsQuery,
  platformTenantDetailSchema,
  platformTenantsSchema,
} from '@rede-social/contracts';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { ApiClientError, loadOrRedirect } from '@/lib/bootstrap';

/**
 * Platform RPC client (D-21/D-23, ROLE-05) — server-only: every read goes to `/v1/platform/*` with
 * the session's Bearer + `x-tenant-host`, `cache: 'no-store'` on both sides, never through a cache
 * directive. The API is the ONLY authority on who is a platform admin: a 200 from
 * `GET /v1/platform/tenants` is the proof, a 401/403 is a navigation (`platformRedirectPath`).
 */

/** Page size of the tenant list (`limit` default, UI-SPEC pagination). */
export const PANEL_PAGE_SIZE = 25;

/** The panel formats every date in the platform's own zone (dates are server-rendered strings). */
export const PANEL_TIME_ZONE = 'America/Sao_Paulo';

/**
 * `dd/MM/yyyy` (or `dd/MM/yyyy HH:mm`) in pt-BR, computed on the server and passed to client rows as
 * plain strings so a row never hydrates with a different clock than the one that rendered it.
 */
export function formatPanelDate(iso: string, style: 'date' | 'dateTime' = 'date'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: PANEL_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(style === 'dateTime' ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

/** Serialises only the defined keys of a list query (`q`, `status`, `cursor`, `limit`). */
export function buildTenantsQuery(query: Partial<PlatformTenantsQuery>): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  return params.toString();
}

async function throwEnvelope(res: Response): Promise<never> {
  let code = 'HTTP_ERROR';
  let details: Record<string, unknown> | undefined;
  let requestId: string | undefined;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; details?: Record<string, unknown>; requestId?: string };
    };
    if (typeof body?.error?.code === 'string') {
      code = body.error.code;
      details = body.error.details;
      requestId = body.error.requestId;
    }
  } catch {
    // Non-JSON body (proxy error page): the status alone decides what the caller does.
  }
  throw new ApiClientError(res.status, code, details, requestId);
}

/**
 * `GET /v1/platform/tenants?{qs}` (D-21), deduplicated per render by React `cache` keyed by the
 * SERIALISED query (`cache` compares primitives, not object literals): the `(app)` layout, `/inicio`,
 * the panel layout and the list page share one call per distinct query.
 *
 * This call is also the AUTHORISATION of the platform host: only `platform_admins` get a 200, and
 * only off a tenant host (D-23). Anything else throws `ApiClientError`; screens go through
 * `requirePlatformTenants()`, which signs the device out — the web tier never decides who is a super
 * admin from claims.
 */
export const getPlatformTenants = cache(async (qs = ''): Promise<PlatformTenants> => {
  const res = await apiFetch(`/v1/platform/tenants${qs ? `?${qs}` : ''}`);
  if (!res.ok) await throwEnvelope(res);
  return platformTenantsSchema.parse(await res.json());
});

/**
 * `GET /v1/platform/tenants/{id}` — the tenant page's detail (branding, modules, domains, invites,
 * admins), deduplicated per render so the `tenants/[id]` layout and the active tab share one call.
 * 404 `NOT_FOUND` surfaces as `ApiClientError`; `requirePlatformTenantDetail` turns it into
 * `notFound()`.
 */
export const getPlatformTenantDetail = cache(async (id: string): Promise<PlatformTenantDetail> => {
  const res = await apiFetch(`/v1/platform/tenants/${encodeURIComponent(id)}`);
  if (!res.ok) await throwEnvelope(res);
  return platformTenantDetailSchema.parse(await res.json());
});

/**
 * Platform refusal -> where the session goes. 401: back to login. A member (403 `FORBIDDEN`) or a
 * platform session that wandered onto a tenant host (403 `TENANT_HOST_MISMATCH`) is signed out by the
 * same `/auth/host-mismatch` Route Handler the tenant branch uses, with no query string, so the screen
 * names no tenant (D-23). Anything else: `null` — the caller rethrows.
 */
export function platformRedirectPath(error: ApiClientError): string | null {
  if (error.status === 401) return '/entrar';
  if (error.code === 'FORBIDDEN' || error.code === 'TENANT_HOST_MISMATCH') {
    return '/auth/host-mismatch';
  }
  return null;
}

/**
 * The tenant list every platform-host screen needs, or a redirect. D-21/D-23: the platform host is
 * authorised by the API, never by claims — a 200 from `/v1/platform/tenants` IS the proof this session
 * is a platform_admin on the right host. Both a layout and the page rendered inside it must call THIS
 * (not `getPlatformTenants`) so every concurrently rendered segment ends with NEXT_REDIRECT; the React
 * `cache` on `getPlatformTenants` still guarantees a single call per render and query.
 */
export async function requirePlatformTenants(
  query: Partial<PlatformTenantsQuery> = {},
): Promise<PlatformTenants> {
  const qs = buildTenantsQuery(query);
  return loadOrRedirect(() => getPlatformTenants(qs), platformRedirectPath);
}

/**
 * The panel layout's authorisation probe: the cheapest platform read. A 200 here IS the proof this
 * session is a platform_admin on the platform host (D-23); 401/403 redirect through
 * `platformRedirectPath`. Called by `(platform)/plataforma/layout.tsx` AFTER the host gate.
 */
export async function requirePlatformAccess(): Promise<void> {
  await requirePlatformTenants({ limit: 1 });
}

const uuidSchema = z.uuid();

/**
 * The tenant detail a `tenants/[id]/*` segment needs, or a navigation: a non-uuid id never reaches
 * the API (T-02-61), an unknown id (404 `NOT_FOUND`) renders the segment's not-found screen, and
 * 401/403 redirect like every other platform read. `notFound()` throws, so it is called AFTER the
 * try/catch — the same Next 16 rule `loadOrRedirect` follows for `redirect()`.
 */
export async function requirePlatformTenantDetail(id: string): Promise<PlatformTenantDetail> {
  if (!uuidSchema.safeParse(id).success) notFound();
  let missing = false;
  try {
    return await loadOrRedirect(() => getPlatformTenantDetail(id), platformRedirectPath);
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 404 || error.code === 'NOT_FOUND')) {
      missing = true;
    } else {
      throw error;
    }
  }
  if (missing) notFound();
  throw new Error('unreachable');
}

/** One row of the tenant list as the table renders it — every value already a string or a count. */
export type TenantRowView = {
  id: string;
  slug: string;
  displayName: string;
  status: 'active' | 'suspended';
  primaryHost: string | null;
  modulesCount: number;
  /** The `modulesCount` ICU plural, rendered on the server (`tp('modulesCount', { count })`). */
  modulesLabel: string;
  createdAtLabel: string;
};

/** Maps a list item to its row view; `modulesLabel` is filled by the caller with the catalog. */
export function toTenantRow(
  item: PlatformTenants['tenants'][number],
  modulesLabel: (count: number) => string,
): TenantRowView {
  const count = item.enabledModules.length;
  return {
    id: item.id,
    slug: item.slug,
    displayName: item.displayName,
    status: item.status === 'suspended' ? 'suspended' : 'active',
    primaryHost: item.primaryHost,
    modulesCount: count,
    modulesLabel: modulesLabel(count),
    createdAtLabel: formatPanelDate(item.createdAt),
  };
}

/** The host the tenant page header links: the primary domain, only once verified (D-36). */
export function primaryVerifiedHost(detail: PlatformTenantDetail): string | null {
  const domain = detail.domains.find((d) => d.isPrimary && d.verificationStatus === 'verified');
  return domain?.host ?? null;
}
