import {
  type PlatformTenantDetail,
  type PlatformTenants,
  type PlatformTenantsQuery,
  platformTenantDetailSchema,
  platformTenantsSchema,
} from '@rede-social/contracts';
import {
  bancoFilterSchema,
  type DatabaseOverview,
  databaseOverviewSchema,
  type TenantDatabaseSummary,
} from '@rede-social/contracts/projects';
import {
  SOCIAL_SETTINGS_DEFAULTS,
  type SocialSettings,
  socialSettingsAnswerSchema,
} from '@rede-social/module-social/contracts';
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

/**
 * "12 de outubro de 2026" in the platform's zone (09.2-19, UI-D-537): the long date of "Preparação
 * concluída em {date}.". Server-computed like every panel date; an unparsable value reads as "".
 */
export function formatPanelLongDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: PANEL_TIME_ZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/**
 * Serialises only the defined keys of a list query (`q`, `status`, `banco`, `cursor`, `limit`).
 * `banco` and `status` are one single-select row (UI-D-540) and the API answers 400 for both, so when
 * both arrive `banco` wins and `status` is not sent.
 */
export function buildTenantsQuery(query: Partial<PlatformTenantsQuery>): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.banco) params.set('banco', query.banco);
  else if (query.status) params.set('status', query.status);
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
 * `GET /v1/platform/tenants/{id}/database` (09.2-14, UI-D-536): the Banco tab's one read - the derived
 * state, the bootstrap steps, the schema counts, the last check and whether credentials are HELD (never
 * their values). The answer is parsed with the contract's strict schema, so a field that could carry a
 * credential would fail here rather than reach a screen. A refusal or a failed read throws
 * `ApiClientError`; the page goes through `requirePlatformTenantDatabase`, the segment's `error.tsx`
 * renders anything else.
 */
export async function getTenantDatabase(id: string): Promise<DatabaseOverview> {
  const res = await apiFetch(`/v1/platform/tenants/${encodeURIComponent(id)}/database`);
  if (!res.ok) await throwEnvelope(res);
  return databaseOverviewSchema.parse(await res.json());
}

/**
 * The overview the Banco tab renders, or a navigation: 401/403 redirect like every platform read.
 * Any other failure (a 5xx, a body the strict schema refuses) is rethrown so the segment's
 * `error.tsx` shows the card "Algo deu errado" inside the unchanged tenant frame (UI-D-544).
 */
export async function requirePlatformTenantDatabase(id: string): Promise<DatabaseOverview> {
  return loadOrRedirect(() => getTenantDatabase(id), platformRedirectPath);
}

/**
 * `GET /v1/platform/tenants/{id}/modules/social/settings` (09-06, D-474): the EFFECTIVE member media
 * limits of one tenant, for the limits sheet of the Módulos tab (09-12). It NEVER throws: a 404 (no
 * `social` row yet), any other refusal, an unreadable body and a network failure all answer the
 * contract defaults, so the sheet always renders its fields with values (UI E09 empty/loading - no
 * skeleton). The tab already proved the session with `requirePlatformTenantDetail`, and the save
 * goes through the API's own `super_admin` guard (T-09-30), so a swallowed read refusal exposes
 * nothing. Deduplicated per render by React `cache`.
 */
export const getSocialSettings = cache(async (tenantId: string): Promise<SocialSettings> => {
  try {
    const res = await apiFetch(
      `/v1/platform/tenants/${encodeURIComponent(tenantId)}/modules/social/settings`,
    );
    if (!res.ok) return defaultSocialSettings();
    const parsed = socialSettingsAnswerSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : defaultSocialSettings();
  } catch {
    return defaultSocialSettings();
  }
});

/** A fresh, mutable copy of the contract defaults (the constant is `as const`, readonly). */
function defaultSocialSettings(): SocialSettings {
  const { media } = SOCIAL_SETTINGS_DEFAULTS;
  return { media: { ...media, video: { ...media.video } } };
}

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
  /**
   * The derived database state and the schema counts of the row (09.2-14, UI-D-540). Absent only for
   * a row built without the fact: the table then renders "Não verificado" (P103), never nothing.
   */
  database?: TenantDatabaseSummary;
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
    database: item.database,
  };
}

const listQSchema = z.string().trim().min(1).max(60);
const listStatusSchema = z.enum(['active', 'suspended']);
const listLimitSchema = z.coerce.number().int().min(1).max(100);

/** What `/plataforma` reads from its URL: each parameter parsed alone, an invalid one dropped (T-02-67). */
export type TenantListSearch = {
  q?: string;
  status?: 'active' | 'suspended';
  banco?: 'problema';
  limit: number;
  /** Whether the URL carried a valid `limit` (the toolbar only echoes explicit values). */
  explicitLimit: boolean;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The list page's query from its search params (09.2-20, UI-D-540). `status` and `banco` are one
 * single-select chip row, so a hand-typed URL carrying both keeps `banco` (the API refuses both with
 * a 400); a bad value of either is dropped, never a 500.
 */
export function parseTenantListQuery(
  sp: Record<string, string | string[] | undefined>,
): TenantListSearch {
  const q = listQSchema.safeParse(firstValue(sp.q));
  const status = listStatusSchema.safeParse(firstValue(sp.status));
  const banco = bancoFilterSchema.safeParse(firstValue(sp.banco));
  const limit = listLimitSchema.safeParse(firstValue(sp.limit));
  return {
    q: q.success ? q.data : undefined,
    status: status.success && !banco.success ? status.data : undefined,
    banco: banco.success ? banco.data : undefined,
    limit: limit.success ? limit.data : PANEL_PAGE_SIZE,
    explicitLimit: limit.success,
  };
}

/** The host the tenant page header links: the primary domain, only once verified (D-36). */
export function primaryVerifiedHost(detail: PlatformTenantDetail): string | null {
  const domain = detail.domains.find((d) => d.isPrimary && d.verificationStatus === 'verified');
  return domain?.host ?? null;
}
