import { EmptyState, PageHeader } from '@rede-social/ui';
import { CircleAlert } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { loadMemberProfile, loadOwnProfile } from '@/lib/profile';
import { getHostTenant } from '@/lib/tenant-host';

/**
 * `/membros/[membershipId]` (PROF-02, UI-SPEC §Member profile) — another member of the SAME
 * community: photo, display name, bio. **Nothing else.** No role badge, no join date, no counts, no
 * follow, no message (D-45) — and the payload behind it is `.strict()`, so a field added to the row
 * later cannot leak onto this screen without failing the contract.
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
  const [t, own, result] = await Promise.all([
    getTranslations('members'),
    loadOwnProfile(),
    loadMemberProfile(membershipId),
  ]);

  if (own && own.membershipId === membershipId) redirect('/perfil');
  if (result.status === 'not-found') notFound();

  if (result.status === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3">
        <PageHeader
          backHref="/membros"
          backLabel={t('back')}
          stickyTop="0px"
          className="md:static md:px-0"
        />
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

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3">
      <PageHeader
        backHref="/membros"
        backLabel={t('back')}
        stickyTop="0px"
        className="md:static md:px-0"
      />
      <ProfileHeader
        headingLevel={1}
        displayName={result.member.displayName}
        avatarAssetId={result.member.avatarAssetId}
        bio={result.member.bio}
      />
    </div>
  );
}
