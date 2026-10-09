import { KERNEL_PERMISSIONS } from '@rede-social/contracts/moderation';
import { EmptyState, PageHeader } from '@rede-social/ui';
import { CircleAlert } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ProfileAdminTrigger } from '@/components/admin/ProfileAdminTrigger';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { loadAdminMemberForProfile } from '@/lib/admin-members';
import { requireBootstrap } from '@/lib/bootstrap';
import { instagramLinkView } from '@/lib/feed-view';
import { loadMemberProfile, loadOwnProfile } from '@/lib/profile';
import { splitProfileBio } from '@/lib/profile-instagram';
import { getHostTenant } from '@/lib/tenant-host';

/**
 * `/membros/[membershipId]` (PROF-02, UI-SPEC §Member profile) — another member of the SAME
 * community: photo, display name, bio. **Nothing else.** No role badge, no join date, no counts, no
 * follow, no message (D-45) — and the payload behind it is `.strict()`, so a field added to the row
 * later cannot leak onto this screen without failing the contract. The member's Instagram
 * (2026-10-09) is not a new field: it is a line of the bio (`lib/profile-instagram.ts`), split here
 * into the text and a link under the name, the link their posts carry (`instagramLinkView`).
 *
 * `PageHeader` carries no title on purpose: the display name IS this screen's single `h1`
 * (`headingLevel={1}`), matching the Phase 2 one-h1 rule.
 *
 * **The caller's own membership redirects to `/perfil`** (UI-D-03): a member never meets themselves
 * as a stranger. That is the ONLY special case — the directory's list predicate stays exactly
 * D-47's, and the caller still appears in their own list unfiltered.
 *
 * **Every miss is one screen.** Unknown id, another tenant's id, invited, blocked, soft-deleted: the
 * API answers ONE indistinguishable bare 404 (D-23/TENANT-04) and this route turns all of them into
 * the same `notFound()`. A transport or 5xx failure is a DIFFERENT screen ("Algo deu errado"), so
 * "we could not reach the server" is never dressed up as "this person is not in your community".
 *
 * **The admin entry (D-340, UI-D-275, 08-05).** For holders of `members.manage` or
 * `moderation.manage` in `bootstrap.permissions` — the same composed values the API guards with — the
 * `PageHeader` carries a trailing `ProfileAdminTrigger` that opens THE member admin sheet for this
 * membership. For anyone else nothing renders: the trigger is absent from the DOM and no admin read
 * is made (T-08-30). It renders only AFTER the own-profile redirect, so it can never target the
 * viewer. The profile itself (photo, name, bio) is unchanged.
 *
 * `redirect()` and `notFound()` both throw (Next 16), so both sit OUTSIDE any try/catch.
 */
export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ membershipId: string }>;
}) {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  const { membershipId } = await params;
  const [t, tf, own, result] = await Promise.all([
    getTranslations('members'),
    getTranslations('feed'),
    loadOwnProfile(),
    loadMemberProfile(membershipId),
  ]);

  if (own && own.membershipId === membershipId) redirect('/perfil');
  if (result.status === 'not-found') notFound();

  if (result.status === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3">
        <PageHeader backHref="/membros" backLabel={t('back')} className="md:static md:px-0" />
        <EmptyState
          variant="card"
          icon={CircleAlert}
          title={t('errors.title')}
          body={t('errors.generic')}
          action={
            <a
              href={`/membros/${encodeURIComponent(membershipId)}`}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover"
            >
              {t('errors.retry')}
            </a>
          }
        />
      </div>
    );
  }

  // The admin trigger: permission holders only, and only after the own-profile redirect above.
  const bootstrap = await requireBootstrap();
  const canManageMembers = bootstrap.permissions.includes(KERNEL_PERMISSIONS.membersManage);
  const canModerate = bootstrap.permissions.includes(KERNEL_PERMISSIONS.moderationManage);
  const adminMember =
    canManageMembers || canModerate ? await loadAdminMemberForProfile(membershipId) : null;
  // 2026-10-09: the bio carries the member's Instagram line; the header shows the text and the link.
  const { text: bio, instagram } = splitProfileBio(result.member.bio);

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3">
      <PageHeader
        backHref="/membros"
        backLabel={t('back')}
        className="md:static md:px-0"
        trailing={
          adminMember ? (
            <ProfileAdminTrigger
              member={adminMember}
              tenantName={bootstrap.tenant.displayName}
              canModerate={canModerate}
              canManageMembers={canManageMembers}
            />
          ) : undefined
        }
      />
      <ProfileHeader
        headingLevel={1}
        displayName={result.member.displayName}
        avatarAssetId={result.member.avatarAssetId}
        bio={bio || null}
        instagram={instagram === null ? null : instagramLinkView(instagram, tf)}
      />
    </div>
  );
}
