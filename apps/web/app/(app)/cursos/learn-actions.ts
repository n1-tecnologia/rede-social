'use server';

import {
  learnCatalogueQuerySchema,
  learnLivesQuerySchema,
  type ProgressBody,
  progressBodySchema,
} from '@rede-social/module-courses/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireBootstrap } from '@/lib/bootstrap';
import {
  deleteLiveReminder,
  getLearnCatalogue,
  getLearnLives,
  getLearnMaterialUrl,
  type LessonRefusal,
  putLessonProgress,
  putLiveReminder,
} from '@/lib/courses-learn';
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

/* ── 08.5-08: the lesson player's writes and material URLs (COURSE-19, COURSE-21, D-427) ─────── */

/**
 * What the player does with a refusal (UI-D-433): `lesson_locked` → "Esta aula agora é exclusiva…"
 * and a refresh onto the lock page; `lesson_sequence_locked` → "Esta aula ficou bloqueada…" and the
 * same refresh; `gone` (a removed lesson, the module switched off) → "Esta aula não está mais
 * disponível." and the course page; `generic` → the caller's own failure (a dropped tick, the
 * completion toast, the material toast).
 */
export type LessonRefusalCode = 'lesson_locked' | 'lesson_sequence_locked' | 'gone' | 'generic';

export type LessonProgressActionResult =
  | {
      ok: true;
      /** False on the API's 204 (an `admin_tenant`; the preview never sends one, D-422). */
      written: boolean;
      /** The stored one-way completion instant, null while the lesson is not complete. */
      completedAt: string | null;
    }
  | { ok: false; code: LessonRefusalCode };

const lessonIdSchema = z.uuid();

/** A lesson route's outcome → the client's code; a session refusal navigates (outside any try). */
function refusalCode(outcome: LessonRefusal): LessonRefusalCode {
  if (outcome.status === 'locked') {
    return outcome.reason === 'purchase' ? 'lesson_locked' : 'lesson_sequence_locked';
  }
  if (outcome.status === 'not_found' || outcome.status === 'disabled') return 'gone';
  return 'generic';
}

async function writeProgress(
  lessonId: string,
  body: ProgressBody,
): Promise<LessonProgressActionResult> {
  const outcome = await putLessonProgress(lessonId, body);
  if (outcome.status === 'redirect') redirect(outcome.path);
  if (outcome.status === 'ok') {
    return outcome.written
      ? { ok: true, written: true, completedAt: outcome.progress.completedAt }
      : { ok: true, written: false, completedAt: null };
  }
  if (outcome.status === 'error') {
    // Shape only: the status and the code, never a lesson id or a position (V8).
    console.error('courses.progress_write_failed', {
      status: outcome.httpStatus,
      code: outcome.code,
    });
  }
  return { ok: false, code: refusalCode(outcome) };
}

/**
 * One playback write (a 15-second tick, a pause, the end; D-427): the SAME strict body the API
 * validates (`progressBodySchema`: an integer 0–14400) runs here first, so a crafted position never
 * leaves the server. Silent by design (UI-D-433): the client drops a failed tick and only acts on a
 * lock, a removal, or a newly set `completedAt` (the server's 90%).
 */
export async function saveProgressAction(
  lessonId: string,
  positionSeconds: number,
): Promise<LessonProgressActionResult> {
  if (!lessonIdSchema.safeParse(lessonId).success) return { ok: false, code: 'generic' };
  const body = progressBodySchema.safeParse({ positionSeconds });
  if (!body.success) return { ok: false, code: 'generic' };
  return writeProgress(lessonId, body.data);
}

/**
 * "Marcar como concluída" (D-427): `{ completed: true }`. One-way — there is no "desmarcar", and the
 * contract refuses `false`. The answer's `completedAt` swaps the zone to the done block.
 */
export async function completeLessonAction(lessonId: string): Promise<LessonProgressActionResult> {
  if (!lessonIdSchema.safeParse(lessonId).success) return { ok: false, code: 'generic' };
  return writeProgress(lessonId, { completed: true });
}

export type LearnMaterialUrlActionResult =
  | { ok: true; url: string }
  | { ok: false; code: LessonRefusalCode };

/**
 * A member's material tap (COURSE-19): the ten-minute signed URL minted for THIS tap, through the
 * member route (the lesson's one access answer, never the admin signer). The URL crosses to the
 * client once, is opened `noopener,noreferrer` and dropped; it is never cached, persisted or logged.
 */
export async function learnMaterialUrlAction(
  lessonId: string,
  materialId: string,
): Promise<LearnMaterialUrlActionResult> {
  if (
    !lessonIdSchema.safeParse(lessonId).success ||
    !lessonIdSchema.safeParse(materialId).success
  ) {
    return { ok: false, code: 'generic' };
  }
  const outcome = await getLearnMaterialUrl(lessonId, materialId);
  if (outcome.status === 'redirect') redirect(outcome.path);
  if (outcome.status === 'ok') return { ok: true, url: outcome.material.url };
  return { ok: false, code: refusalCode(outcome) };
}

/* ── 08.6-11: the live reminder toggle (D-444, D-446, D-422, COURSE-40, UI-D-453) ────────────── */

/**
 * What the toggle does with a refusal (UI-D-453): `live_locked` → "Esta live agora é exclusiva." and
 * a refresh onto the locked variant; `reminder_closed` → "Esta live já começou ou foi cancelada."
 * and a refresh; `gone` → "Esta live não está mais disponível." and the lives list; `generic` → the
 * on / off failure toast. Every refusal reverts the optimistic state.
 */
export type LiveReminderRefusalCode = 'live_locked' | 'reminder_closed' | 'gone' | 'generic';

export type LiveReminderActionResult =
  | { ok: true; on: boolean }
  | { ok: false; code: LiveReminderRefusalCode };

const liveIdSchema = z.uuid();

/**
 * The reminder toggle's one write (D-444): `on` → `PUT`, off → `DELETE`
 * `/v1/courses/learn/lives/{liveId}/reminder` through the BFF with the caller's session. The live id
 * is attacker-controlled (a server action is a public endpoint), so it is checked as a uuid HERE
 * first; the API re-checks the live, its tenant, the caller's access (403 `live_locked`) and its
 * state (409 `reminder_closed`), and RLS keeps the row the caller's own (T-08.6-27). The admin's
 * preview never calls this (the toggle is disabled, D-422); the API would answer 204 anyway.
 */
export async function setLiveReminderAction(
  liveId: string,
  on: boolean,
): Promise<LiveReminderActionResult> {
  if (!liveIdSchema.safeParse(liveId).success || typeof on !== 'boolean') {
    return { ok: false, code: 'generic' };
  }
  const outcome = on ? await putLiveReminder(liveId) : await deleteLiveReminder(liveId);
  if (outcome.status === 'redirect') redirect(outcome.path);
  if (outcome.status === 'ok') return { ok: true, on: outcome.on };
  if (outcome.status === 'locked') return { ok: false, code: 'live_locked' };
  if (outcome.status === 'closed') return { ok: false, code: 'reminder_closed' };
  if (outcome.status === 'gone') return { ok: false, code: 'gone' };
  // Shape only: the status and the code, never the live id (V8).
  console.error('courses.live_reminder_write_failed', {
    status: outcome.httpStatus,
    code: outcome.code,
  });
  return { ok: false, code: 'generic' };
}
