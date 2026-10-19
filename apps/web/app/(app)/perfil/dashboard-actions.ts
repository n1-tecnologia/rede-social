'use server';

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { getOwnerBandMembers, getOwnerMemberList } from '@/lib/dashboard';
import {
  bandMemberRowView,
  memberListRowViews,
  OWNER_LIST_MORE_PAGE_SIZE,
  type OwnerListPageResult,
  ownerListMoreInputSchema,
  viewOfBandList,
} from '@/lib/owner-list-view';

/**
 * The owner panel's "Ver todos" pages (08.7-05, UI-D-477), in the `cursos/actions.ts` conventions.
 * A server action is a public endpoint, so the input is parsed with `ownerListMoreInputSchema`
 * FIRST (T-08.7-16: a closed `kind`, enum band and list ids, uuid ids, a bounded cursor; anything
 * else is refused before a request is made), the viewer must be the tenant's `admin_tenant` (the
 * page gate's twin), and the API re-checks role, tenant and cursor on every page. A refusal the
 * bootstrap knows becomes a navigation OUTSIDE the try (Next 16: `redirect()` throws); any other
 * failure is `{ error: true }`, the island's retry line.
 *
 * It returns FINISHED row views built by the same functions as the server's first page, so the
 * island formats nothing; one page is the next 20 rows. Later plans add kinds here, not islands.
 * Logs carry the failure SHAPE only, never a name.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */
export async function loadMoreOwnerListAction(input: unknown): Promise<OwnerListPageResult> {
  const parsed = ownerListMoreInputSchema.safeParse(input);
  if (!parsed.success) return { error: true };
  const request = parsed.data;

  // Outside the try: `requireBootstrap()` navigates (throws) for a refused session.
  const bootstrap = await requireBootstrap();
  if (bootstrap.membership.role !== 'admin_tenant') return { error: true };
  const timeZone = bootstrap.tenant.timezone;

  let refusal: string | null = null;
  let result: OwnerListPageResult = { error: true };
  try {
    const t = await getTranslations('dashboard');
    const nowMs = Date.now();

    if (request.kind === 'band') {
      const read = await getOwnerBandMembers({
        band: request.band,
        scope: request.scope,
        scopeId: request.scopeId,
        cursor: request.cursor,
        limit: OWNER_LIST_MORE_PAGE_SIZE,
      });
      if (read.status === 'redirect') {
        refusal = read.path;
      } else if (read.status === 'ok' && read.answer.state === 'ready') {
        const view = viewOfBandList(request);
        result = {
          rows: read.answer.rows.map((row) =>
            bandMemberRowView(t, row, { view, band: request.band, timeZone, nowMs }),
          ),
          nextCursor: read.answer.nextCursor,
        };
      }
    } else {
      const read = await getOwnerMemberList(request.membershipId, request.list, {
        cursor: request.cursor,
        limit: OWNER_LIST_MORE_PAGE_SIZE,
      });
      if (read.status === 'redirect') {
        refusal = read.path;
      } else if (read.status === 'ok' && read.answer.state === 'ready') {
        result = {
          rows: memberListRowViews(t, read.answer, { timeZone, nowMs }),
          nextCursor: read.answer.nextCursor,
        };
      }
    }
  } catch (error) {
    console.error('dashboard.owner_list_page_failed', {
      name: error instanceof Error ? error.name : typeof error,
    });
  }

  if (refusal) redirect(refusal);
  return result;
}
