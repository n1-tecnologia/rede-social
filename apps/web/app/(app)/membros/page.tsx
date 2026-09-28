import { MEMBERS_MAX_QUERY_LENGTH } from '@rede-social/contracts/profiles';
import { PageHeader } from '@rede-social/ui';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { loadMembers } from '@/lib/profile';
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
 * and paginated by keyset, reached from the "Membros" row on `/perfil` (R-11: a row, not a fifth nav
 * tab — D-40's bar already reaches four by Phase 6).
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

  const [t, sp] = await Promise.all([getTranslations('members'), searchParams]);
  const q = parseQuery(sp);
  const page = await loadMembers({ q: q || undefined });

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      {/* `stickyTop="0px"` pins the header at the TOP of the scroll container's padding box, which
          is where it already sits in normal flow. The primitive's default
          `calc(var(--safe-top) + 3rem)` is measured from that SAME padding edge (CSS shrinks a
          sticky element's constraint rectangle by the scrollport's padding), so the default pushes
          the header ~60px DOWN over whatever follows it — harmless on a screen that opens with
          padding, fatal here, where the next element is the sticky search pill. */}
      <PageHeader
        title={t('title')}
        backHref="/perfil"
        backLabel={t('back')}
        stickyTop="0px"
        className="md:static md:px-0"
      />

      <MembersList
        q={q}
        initialItems={page?.items ?? []}
        initialCursor={page?.nextCursor ?? null}
        initialError={page === null}
        tenantName={tenantDisplayName(hostTenant)}
      />
    </div>
  );
}
