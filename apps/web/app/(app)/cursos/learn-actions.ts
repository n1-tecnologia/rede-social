'use server';

import {
  learnCatalogueQuerySchema,
  learnLivesQuerySchema,
} from '@rede-social/module-courses/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { getLearnCatalogue, getLearnLives } from '@/lib/courses-learn';
import {
  type CourseCardView,
  courseAccessById,
  courseCardView,
  type LiveCardView,
  liveAccessById,
  liveCardView,
} from '@/lib/courses-member-view';
import { getCourseAccessList, getLiveAccessList } from '@/lib/store';

/**
 * The member catalogue's paging and refresh (08.5-06, COURSE-17, planning decision 4), in the hub's
 * `actions.ts` conventions: the SAME Zod the API validates with (`learnCatalogueQuerySchema`) runs
 * BEFORE the request — a server action is a public endpoint, so a crafted cursor or category is
 * refused here first and by the API second — a refusal the bootstrap knows becomes a navigation
 * OUTSIDE any try/catch (Next 16: `redirect()` throws), and anything else is a code the client maps
 * to catalog copy.
 *
 * Every page comes back as FINISHED card views (`courseCardView`), with the store's tags read beside
 * it (one `GET /v1/store/course-access` per page, only while the store is on; a failed read draws no
 * tag, never a wrong one — UI-D-442). The `preview` flag only decorates hrefs with `?ver=aluno`; the
 * pages themselves re-check `courses.manage`, so it grants nothing.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

export type CataloguePageResult =
  | { ok: true; items: CourseCardView[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

async function readCataloguePage(
  categoryId: string | null,
  cursor: string | undefined,
  preview: boolean,
): Promise<CataloguePageResult> {
  const query = learnCatalogueQuerySchema.safeParse({
    ...(categoryId === null ? {} : { categoryId }),
    ...(cursor === undefined ? {} : { cursor }),
  });
  if (!query.success) return { ok: false, code: 'generic' };

  const bootstrap = await requireBootstrap();
  const storeOn = bootstrap.modules.some((module) => module.key === 'store');
  const [result, access, t] = await Promise.all([
    getLearnCatalogue({
      categoryId: query.data.categoryId,
      cursor: query.data.cursor,
      limit: query.data.limit,
    }),
    storeOn ? getCourseAccessList() : Promise.resolve(null),
    getTranslations(),
  ]);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status !== 'ok') return { ok: false, code: 'generic' };

  const byId = courseAccessById(access);
  const isManager = preview === true;
  return {
    ok: true,
    items: result.page.items.map((card) =>
      courseCardView(card, byId?.get(card.id), t, { preview: isManager }),
    ),
    nextCursor: result.page.nextCursor,
  };
}

/** One more page of the catalogue, APPENDED by the client (never replaces, P09). */
export async function loadMoreCatalogueAction(
  categoryId: string | null,
  cursor: string,
  preview: boolean,
): Promise<CataloguePageResult> {
  return readCataloguePage(categoryId, cursor, preview);
}

/** Page 1 again: what `PullToRefresh` and the first-load retry call. */
export async function refreshCatalogueAction(
  categoryId: string | null,
  preview: boolean,
): Promise<CataloguePageResult> {
  return readCataloguePage(categoryId, undefined, preview);
}

/* ── The Lives tab: only "Gravadas" pages (UI-D-434, D-431) ──────────────────────────────────── */

export type LivesPageResult =
  | { ok: true; items: LiveCardView[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

/**
 * One more page of the "Gravadas" group, APPENDED by the client. Later pages of the agenda carry
 * `upcoming: []`, so only `recorded` is read; the cards' dates are formatted HERE in the tenant's
 * timezone from the cached bootstrap (no clock, UI-D-288), and the "Exclusiva" tag from the store's
 * live access read beside the page (store on only; a failed read draws no tag).
 */
export async function loadMoreLivesAction(
  cursor: string,
  preview: boolean,
): Promise<LivesPageResult> {
  const query = learnLivesQuerySchema.safeParse({ cursor });
  if (!query.success || !query.data.cursor) return { ok: false, code: 'generic' };

  const bootstrap = await requireBootstrap();
  const storeOn = bootstrap.modules.some((module) => module.key === 'store');
  const [result, access, t] = await Promise.all([
    getLearnLives({ cursor: query.data.cursor }),
    storeOn ? getLiveAccessList() : Promise.resolve(null),
    getTranslations(),
  ]);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status !== 'ok') return { ok: false, code: 'generic' };

  const byId = liveAccessById(access);
  const timeZone = bootstrap.tenant.timezone;
  const isManager = preview === true;
  return {
    ok: true,
    items: result.page.recorded.map((card) =>
      liveCardView(card, byId?.get(card.id), timeZone, t, { preview: isManager }),
    ),
    nextCursor: result.page.nextCursor,
  };
}
