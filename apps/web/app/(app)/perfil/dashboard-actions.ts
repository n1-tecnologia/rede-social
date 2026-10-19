'use server';

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import {
  getOwnerBandMembers,
  getOwnerContent,
  getOwnerContentInteractions,
  getOwnerContentPeople,
  getOwnerContentUnanswered,
  getOwnerMemberList,
} from '@/lib/dashboard';
import {
  contentCommunityNames,
  contentInteractionRowViews,
  contentItemsById,
  contentPeopleRowViews,
  contentPostList,
  contentPostRowView,
  contentReplyRowViews,
} from '@/lib/owner-content-rows';
import {
  bandMemberRowView,
  memberListRowViews,
  OWNER_LIST_MORE_PAGE_SIZE,
  type OwnerListPageResult,
  ownerListMoreInputSchema,
  viewOfBandList,
} from '@/lib/owner-list-view';
import { ownerPanelFlags } from '@/lib/owner-panel';

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
 * 08.7-07 adds Conteúdo's: `content-posts` (a publications list of the area answer, by offset),
 * `content-people` (who liked or commented one publication), `content-interactions` and
 * `content-unanswered` (the comments waiting for the team).
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
  const flags = ownerPanelFlags(bootstrap.modules);

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
    } else if (request.kind === 'content-posts') {
      // A publications list holds every item of the answer: the cursor is the next row's offset.
      const read = await getOwnerContent();
      if (read.status === 'redirect') {
        refusal = read.path;
      } else if (read.status === 'ok' && read.answer.state === 'ready') {
        const answer = read.answer;
        const offset = Number(request.cursor);
        const { items, hrefOf } = contentPostList(answer, request.list, request.contentKind);
        const end = offset + OWNER_LIST_MORE_PAGE_SIZE;
        const ctx = { flags, communities: contentCommunityNames(answer, flags), timeZone };
        result = {
          rows: items
            .slice(offset, end)
            .map((item) => contentPostRowView(t, item, { ...ctx, href: hrefOf(item.id) })),
          nextCursor: end < items.length ? String(end) : null,
        };
      }
    } else if (request.kind === 'content-people') {
      const read = await getOwnerContentPeople(request.itemId, request.who, {
        cursor: request.cursor,
        limit: OWNER_LIST_MORE_PAGE_SIZE,
      });
      if (read.status === 'redirect') {
        refusal = read.path;
      } else if (read.status === 'ok' && read.answer.state === 'ready') {
        const rows = contentPeopleRowViews(t, read.answer, {
          place: request.place,
          itemId: request.itemId,
          timeZone,
          nowMs,
        });
        // The first page carries the members' anchors; an appended card never repeats one.
        result = {
          rows: rows.map((row) => ({ ...row, anchor: undefined })),
          nextCursor: read.answer.nextCursor,
        };
      }
    } else if (request.kind === 'content-interactions') {
      // A row names its publication when it is still in the area answer (its excerpt, its cover).
      const [area, read] = await Promise.all([
        getOwnerContent(),
        getOwnerContentInteractions({ cursor: request.cursor, limit: OWNER_LIST_MORE_PAGE_SIZE }),
      ]);
      if (read.status === 'redirect') {
        refusal = read.path;
      } else if (read.status === 'ok' && read.answer.state === 'ready') {
        const items = contentItemsById(
          area.status === 'ok' && area.answer.state === 'ready' ? area.answer : null,
        );
        const rows = contentInteractionRowViews(t, read.answer.rows, { items, timeZone, nowMs });
        result = {
          rows: rows.map((row) => ({ ...row, anchor: undefined })),
          nextCursor: read.answer.nextCursor,
        };
      }
    } else if (request.kind === 'content-unanswered') {
      const [area, read] = await Promise.all([
        getOwnerContent(),
        getOwnerContentUnanswered({ cursor: request.cursor, limit: OWNER_LIST_MORE_PAGE_SIZE }),
      ]);
      if (read.status === 'redirect') {
        refusal = read.path;
      } else if (read.status === 'ok' && read.answer.state === 'ready') {
        const items = contentItemsById(
          area.status === 'ok' && area.answer.state === 'ready' ? area.answer : null,
        );
        result = {
          rows: contentReplyRowViews(t, read.answer.rows, { items, timeZone, nowMs }),
          nextCursor: read.answer.nextCursor,
        };
      }
    } else if (request.kind === 'member-list') {
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
