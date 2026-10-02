import { KERNEL_PERMISSIONS } from '@rede-social/contracts/moderation';
import { PageHeader } from '@rede-social/ui';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { loadAdminMembers } from '@/lib/admin-members';
import { requireBootstrap } from '@/lib/bootstrap';
import { getHostTenant } from '@/lib/tenant-host';
import { AdminMembersList } from './AdminMembersList';

/**
 * `/configuracoes/membros` (ADMIN-02, MODER-02, D-339, D-340, UI-D-270/271) — every membership of the
 * tenant, the ONLY screen where a blocked member can be found and unblocked.
 *
 * **`notFound()`, never a 403 screen** (UI-D-270): without `members.manage` OR `moderation.manage` in
 * `bootstrap.permissions` — the SAME composed values the API's `requirePermission` reads — and on the
 * platform host, this route answers the app's not-found page, so a member who types the URL never
 * learns the screen exists. The API re-checks the permission on the read itself (403 → `notFound()`
 * in `loadAdminMembers`).
 */
export default async function AdminMembersPage() {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') notFound();

  const bootstrap = await requireBootstrap();
  const canManageMembers = bootstrap.permissions.includes(KERNEL_PERMISSIONS.membersManage);
  const canModerate = bootstrap.permissions.includes(KERNEL_PERMISSIONS.moderationManage);
  if (!canManageMembers && !canModerate) notFound();

  const [t, page] = await Promise.all([getTranslations('admin'), loadAdminMembers()]);

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
      {/* `stickyTop="0px"`: the `/configuracoes/midia` reason (the primitive's default offset is
          measured from the scrollport's padding edge and pushes the header down over the page). */}
      <PageHeader
        title={t('members.title')}
        backHref="/configuracoes"
        backLabel={t('back')}
        stickyTop="0px"
        className="md:static md:px-0"
      />
      <AdminMembersList
        initialItems={page?.items ?? []}
        tenantName={bootstrap.tenant.displayName}
        canModerate={canModerate}
      />
    </div>
  );
}
