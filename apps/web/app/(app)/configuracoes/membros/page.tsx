import {
  ADMIN_MEMBER_STATUSES,
  ADMIN_MEMBERS_MAX_QUERY_LENGTH,
  type AdminMemberStatusFilter,
  KERNEL_PERMISSIONS,
} from '@rede-social/contracts/moderation';
import { PageHeader } from '@rede-social/ui';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { loadAdminMembers } from '@/lib/admin-members';
import { requireBootstrap } from '@/lib/bootstrap';
import { getHostTenant } from '@/lib/tenant-host';
import { AdminMembersList } from './AdminMembersList';

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * `?q=` as the screen reads it (UI E02/partial): trimmed and capped at the contract's length BEFORE
 * the API call, so a hand-typed URL carrying a megabyte of "query" never reaches the API (which would
 * answer 400 for anything over the cap). Absent, empty and spaces-only are the same request.
 */
function parseQuery(sp: SearchParams): string {
  return (first(sp.q) ?? '').trim().slice(0, ADMIN_MEMBERS_MAX_QUERY_LENGTH).trim();
}

/** `?status=`: one of the four chips, and anything else reads as "Todos" (never a 400 from the URL). */
function parseStatus(sp: SearchParams): AdminMemberStatusFilter {
  const raw = first(sp.status);
  return (ADMIN_MEMBER_STATUSES as readonly string[]).includes(raw ?? '')
    ? (raw as AdminMemberStatusFilter)
    : 'all';
}

/**
 * `/configuracoes/membros` (ADMIN-02, MODER-02, D-339, D-340, UI-D-270/271) — every membership of the
 * tenant, the ONLY screen where a blocked member can be found and unblocked.
 *
 * **`notFound()`, never a 403 screen** (UI-D-270): without `members.manage` OR `moderation.manage` in
 * `bootstrap.permissions` — the SAME composed values the API's `requirePermission` reads — and on the
 * platform host, this route answers the app's not-found page, so a member who types the URL never
 * learns the screen exists. The API re-checks the permission on the read itself (403 → `notFound()`
 * in `loadAdminMembers`).
 *
 * Page 1 is read here for the URL's `?q=` and `?status=`, so a shared or reloaded URL opens on the
 * same query; the search, the chips, paging and every state live in `AdminMembersList`.
 */
export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') notFound();

  const bootstrap = await requireBootstrap();
  const canManageMembers = bootstrap.permissions.includes(KERNEL_PERMISSIONS.membersManage);
  const canModerate = bootstrap.permissions.includes(KERNEL_PERMISSIONS.moderationManage);
  if (!canManageMembers && !canModerate) notFound();

  const sp = await searchParams;
  const q = parseQuery(sp);
  const status = parseStatus(sp);
  const [t, page] = await Promise.all([
    getTranslations('admin'),
    loadAdminMembers({ q: q || undefined, status }),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
      {/* The primitive's default offset (`-0.5rem` from the scroll container's padded content edge)
          leaves the header in flow at rest and pins it flush under the TopBar once scrolled; the
          sticky toolbar below pins right under it (`AdminMembersList`, `top-[2.75rem]`). */}
      <PageHeader
        title={t('members.title')}
        backHref="/configuracoes"
        backLabel={t('back')}
        className="md:static md:px-0"
      />
      <AdminMembersList
        q={q}
        status={status}
        initialItems={page?.items ?? []}
        initialCursor={page?.nextCursor ?? null}
        initialError={page === null}
        tenantName={bootstrap.tenant.displayName}
        canModerate={canModerate}
        canManageMembers={canManageMembers}
      />
    </div>
  );
}
