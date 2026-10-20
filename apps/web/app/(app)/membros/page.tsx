import { MEMBERS_MAX_QUERY_LENGTH } from '@rede-social/contracts/profiles';
import { PageHeader } from '@rede-social/ui';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { canBrowseMemberDirectory, canFollowMembers } from '@/lib/member-directory';
import { loadMembers, loadOwnProfile } from '@/lib/profile';
import { loadFollowState } from '@/lib/social';
import { getHostTenant, tenantDisplayName } from '@/lib/tenant-host';
import { MembersList } from './MembersList';

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * `?q=` as the screen reads it: trimmed and capped at the contract's `MEMBERS_MAX_QUERY_LENGTH`, so
 * a hand-typed URL carrying a megabyte of "query" never reaches the API (the API caps it too). An
 * absent, empty or whitespace-only `q` is the SAME request — no filter (03-03's `normaliseQuery`).
 */
function parseQuery(sp: SearchParams): string {
  return (first(sp.q) ?? '').trim().slice(0, MEMBERS_MAX_QUERY_LENGTH);
}

/**
 * `/membros` (PROF-03, UI-SPEC §Member directory) — the tenant's ACTIVE members, searchable by name
 * and paginated by keyset.
 *
 * **Staff, and the member while `social` is on** (`canBrowseMemberDirectory`, 09-10, D-466): it was
 * the staff's only since 2026-10-12 (`admin_tenant` and `support_tenant`), and the composed permission
 * `social.participate` is now the second way in, so the directory is a member's way to find people to
 * follow. Anyone else - a member with `social` off above all - is redirected back to `/perfil`, with
 * or without a `?q=`, before anything is read. A redirect and not `notFound()`: there is no root
 * `not-found.tsx`, so a 404 here would be Next's bare page outside the app. The staff reach the list
 * by its address and from a member profile's back link (`memberProfileExit`); the admin's member
 * management stays `/configuracoes/membros`. `GET /v1/members` also refuses a member without the
 * permission (403 `FORBIDDEN`), and the load-more action refuses them too.
 *
 * **A member's rows are the split row** (UI-D-503): the person's link plus a sibling Seguir / Seguindo
 * button, "Você" on the caller's own row, a `w-24` slot while a state is unknown. The page reads the
 * follow state of the whole first page ONCE (`POST /v1/social/follows/state`, server side), so the
 * rows arrive with their buttons and are never N requests. The staff keep today's single-link row. The
 * member's back link is `/inicio?aba=explorar`, the staff's stays `/perfil`.
 *
 * Server-rendered from `GET /v1/members` for the URL's `?q=`, so the first paint already carries the
 * right page and a shared link opens on the same query. Everything the list shows is the API's
 * answer: the D-47 predicate (`role = 'member'`, active, not soft-deleted) means the community's
 * staff are ABSENT rather than filtered here, so their presence carries no signal (T-03-35), and no
 * row is conditioned on a role — the payload has no role field to condition on.
 *
 * The platform host has no membership directory to show, so it lands back on `/inicio` — the same
 * posture as `/perfil`.
 */
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  // The viewer's OWN role decides (the bootstrap is the layout's, `cache`d: no second request).
  const bootstrap = await requireBootstrap();
  const viewer = { role: bootstrap.membership.role, permissions: bootstrap.permissions };
  if (!canBrowseMemberDirectory(viewer)) redirect('/perfil');
  const canFollow = canFollowMembers(viewer);

  const [t, sp] = await Promise.all([getTranslations('members'), searchParams]);
  const q = parseQuery(sp);
  const [page, own] = await Promise.all([
    loadMembers({ q: q || undefined }),
    canFollow ? loadOwnProfile() : null,
  ]);
  // The first page's follow states, in ONE call and without the caller's own id (their row shows
  // "Você"). A failed read is `null`: the rows hold their slot rather than guess a label (EP-43).
  const viewerMembershipId = own?.membershipId ?? null;
  const initialFollowing =
    canFollow && page
      ? await loadFollowState(
          page.items.map((item) => item.membershipId).filter((id) => id !== viewerMembershipId),
        )
      : null;

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      {/* The primitive's default offset (`-0.5rem` from the scroll container's padded content edge)
          leaves the header in flow at rest and pins it flush under the TopBar once scrolled; the
          sticky search pill below pins right under it (`MembersList`, `top-[2.75rem]`). */}
      <PageHeader
        title={t('title')}
        backHref={canFollow ? '/inicio?aba=explorar' : '/perfil'}
        backLabel={t('back')}
        className="md:static md:px-0"
      />

      <MembersList
        q={q}
        initialItems={page?.items ?? []}
        initialCursor={page?.nextCursor ?? null}
        initialError={page === null}
        tenantName={tenantDisplayName(hostTenant)}
        follow={canFollow ? { viewerMembershipId, initialFollowing } : undefined}
      />
    </div>
  );
}
