'use client';

import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import type { LessonView, ModuleView } from '@rede-social/module-courses/contracts';
import {
  LessonRow,
  MODULE_BAND_CONTROL,
  ModuleCard,
  ReorderList,
} from '@rede-social/module-courses/ui';
import { Button, EmptyState, SectionTitle, useToast } from '@rede-social/ui';
import { Layers, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { useAssetReadiness } from '@/components/media/useAssetReadiness';
import { FadeIn } from '@/components/motion/FadeIn';
import {
  CURRICULUM_SECTION_ID,
  lessonRowView,
  moduleCardView,
  newLessonHref,
} from '@/lib/courses-view';
import { DASHED_OVERRIDES, SECTION_TITLE } from '../admin-styles';
import {
  type ReorderResult,
  reorderLessonsAction,
  reorderModulesAction,
} from '../curriculum-actions';
import { ModuleSheet } from './ModuleSheet';

export interface CurriculumEditorProps {
  courseId: string;
  courseTitle: string;
  /** The server's modules with their lessons, in order; the editor's draft is seeded from them. */
  modules: ModuleView[];
  /** The provider thumbnail of every READY lesson video, minted by the server for this render. */
  thumbnails: Readonly<Record<string, string>>;
  /** 2026-10-22: the course cover, the art of every module band (the tenant gradient without one). */
  coverAssetId?: string | null;
}

type SheetState = { mode: 'new' } | { mode: 'edit'; module: ModuleView; position: number };

/** The "Nova aula" row at the foot of a module's card: a LINK (a route), 44px tall, brand ink. */
const NEW_LESSON =
  'flex min-h-11 items-center justify-center gap-1.5 px-3 text-[13px] font-semibold text-brand transition-colors hover:bg-card-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand';

/** The band's art: the module band is the column's width, at most the 680px column minus padding. */
const BAND_SIZES = '(min-width: 680px) 648px, 100vw';

/** Permutes `items` into the order of `ids`; null when the ids are not exactly the items (a stale list). */
function permute<T extends { id: string }>(
  items: readonly T[],
  ids: readonly string[],
): T[] | null {
  if (ids.length !== items.length) return null;
  const byId = new Map(items.map((item) => [item.id, item]));
  const next: T[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) return null;
    next.push(item);
  }
  return next;
}

/**
 * The curriculum editor (08.3-08, D-406, D-414, UI-D-395, UI-D-396, UI-D-397, UI-D-401, COURSE-05):
 * the "Módulos" section with "Novo módulo", the module cards in order — each with its lesson rows —
 * and ONE `ModuleSheet` for creating and editing.
 *
 * **Every arrow tap writes the parent's WHOLE order at once** (UI-D-397, the whole-order `PUT` of
 * D-414): the host's draft is permuted optimistically, every arrow of that list is disabled until
 * the write answers, success re-seeds from the server's answer with no toast (the live region
 * announces the move), a failure restores the previous order and toasts, and `order_stale` toasts
 * and refreshes the page — the draft was built on a set that no longer exists (T-08.3-10). The two
 * lists (modules; the lessons of each module) save independently.
 *
 * The numeral and the first-module rule read the DRAFT's index, not the stored `position`: after a
 * move the server renumbers 1..N in the order sent, so the index is the truth the next render shows.
 *
 * A lesson whose video is pending/processing polls `useAssetReadiness` and refreshes the page when
 * it settles, so the row flips to the poster (or the `Camera`) without a reload. The thumbnails are
 * this render's and are never stored (T-08.3-18).
 *
 * Focus (UI-D-407): the sheet's trap returns focus to the opener on close; after a removal the
 * opener is gone, so focus moves to the next module's edit control, or to "Novo módulo" (the empty
 * state's "Criar módulo" when none is left).
 *
 * 2026-10-22 (the courses area redesign on the social-igoralves prototype): the heading is 18/800
 * with the draft's "{N} módulos · {N} aulas" on its right; each module is a 16:6 BAND over the
 * course's art (`ModuleCard`: the "Módulo 01" pill, the watermark numeral, the arrows and the pencil
 * as glass discs, `MODULE_BAND_CONTROL`), its lessons ALWAYS visible in the outlined card under it
 * (no accordion) with "Nova aula" at its foot; "Novo módulo" moved from the heading to a dashed
 * block at the end of the list. A module the admin just created enters with `FadeIn` (opacity,
 * client-mounted content only; never under "reduzir movimento"). No behaviour changed.
 */
export function CurriculumEditor({
  courseId,
  courseTitle,
  modules,
  thumbnails,
  coverAssetId = null,
}: CurriculumEditorProps) {
  const t = useTranslations();
  const router = useRouter();
  const toast = useToast();
  const headingId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  const [draft, setDraft] = useState(modules);
  // The SERVER sent different modules (a refresh after a write): re-seed rather than merge.
  const [seed, setSeed] = useState(modules);
  if (seed !== modules) {
    setSeed(modules);
    setDraft(modules);
  }

  const [savingModules, setSavingModules] = useState(false);
  const [savingLessons, setSavingLessons] = useState<Readonly<Record<string, true>>>({});

  /** Outlives the close (`open: false`) so the sheet's exit animation keeps its words. */
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [open, setOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
  const [pendingFocus, setPendingFocus] = useState<{ nextId: string | null } | null>(null);

  useEffect(() => {
    if (!pendingFocus) return;
    let frame = 0;
    let tries = 0;
    const tick = () => {
      if (document.querySelector('[aria-modal="true"]') !== null && tries < 120) {
        tries += 1;
        frame = requestAnimationFrame(tick);
        return;
      }
      const root = rootRef.current;
      const next =
        pendingFocus.nextId === null
          ? null
          : root?.querySelector<HTMLElement>(`[data-module-edit="${pendingFocus.nextId}"]`);
      (
        next ??
        root?.querySelector<HTMLElement>('[data-curriculum-create]') ??
        root?.querySelector<HTMLElement>('[data-curriculum-empty-create]')
      )?.focus({
        preventScroll: true,
      });
      setPendingFocus(null);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [pendingFocus]);

  const openSheet = (state: SheetState) => {
    setSheet(state);
    setSheetKey((key) => key + 1);
    setOpen(true);
  };
  const closeSheet = () => setOpen(false);

  const settle = <T,>(
    result: ReorderResult<T>,
    restore: () => void,
    apply: (items: T[]) => void,
  ) => {
    if (result.ok) {
      apply(result.items);
      return;
    }
    if (result.code === 'order_stale') {
      toast.show({ tone: 'error', message: t('courses.reorder.errors.stale') });
      router.refresh();
      return;
    }
    restore();
    toast.show({ tone: 'error', message: t('courses.reorder.errors.save') });
  };

  const moveModules = async (ids: string[]) => {
    const previous = draft;
    const next = permute(previous, ids);
    if (!next) return;
    setDraft(next);
    setSavingModules(true);
    let result: ReorderResult<ModuleView> = { ok: false, code: 'generic' };
    try {
      result = await reorderModulesAction(courseId, ids);
    } catch (error) {
      console.error('courses.modules_reorder_failed', { error: String(error) });
    }
    setSavingModules(false);
    settle(
      result,
      () => setDraft(previous),
      (items) => setDraft(items),
    );
  };

  const moveLessons = async (moduleId: string, ids: string[]) => {
    const module = draft.find((item) => item.id === moduleId);
    if (!module) return;
    const next = permute(module.lessons, ids);
    if (!next) return;
    const previousLessons = module.lessons;
    const replace = (lessons: LessonView[]) =>
      setDraft((current) =>
        current.map((item) => (item.id === moduleId ? { ...item, lessons } : item)),
      );
    replace(next);
    setSavingLessons((current) => ({ ...current, [moduleId]: true }));
    let result: ReorderResult<LessonView> = { ok: false, code: 'generic' };
    try {
      result = await reorderLessonsAction(courseId, moduleId, ids);
    } catch (error) {
      console.error('courses.lessons_reorder_failed', { error: String(error) });
    }
    setSavingLessons((current) => {
      const { [moduleId]: _done, ...rest } = current;
      return rest;
    });
    settle(result, () => replace(previousLessons), replace);
  };

  const onCreated = (module: ModuleView) => {
    setDraft((current) => [...current, module]);
    toast.show({ tone: 'success', message: t('courses.toasts.moduleCreated') });
    closeSheet();
  };

  const onUpdated = (module: ModuleView) => {
    setDraft((current) => current.map((item) => (item.id === module.id ? module : item)));
    toast.show({ tone: 'success', message: t('courses.toasts.saved') });
    closeSheet();
  };

  const onRemoved = (id: string) => {
    const index = draft.findIndex((item) => item.id === id);
    const next = draft[index + 1] ?? draft[index - 1] ?? null;
    setDraft((current) => current.filter((item) => item.id !== id));
    toast.show({ tone: 'success', message: t('courses.toasts.moduleRemoved') });
    closeSheet();
    setPendingFocus({ nextId: next?.id ?? null });
  };

  const labels = {
    moveUp: (name: string) => t('courses.reorder.moveUp', { name }),
    moveDown: (name: string) => t('courses.reorder.moveDown', { name }),
    moved: (name: string, position: number, total: number) =>
      t('courses.reorder.moved', { name, position, total }),
  };

  const lessonTotal = draft.reduce((sum, module) => sum + module.lessons.length, 0);
  const art = coverAssetId ? (
    <MediaImage
      assetId={coverAssetId}
      widths={PURPOSE_WIDTHS.cover}
      alt=""
      sizes={BAND_SIZES}
      ratio=""
      className="h-full w-full"
      fallback={
        <span
          aria-hidden
          className="block h-full w-full"
          style={{ backgroundImage: 'var(--brand-gradient)' }}
        />
      }
    />
  ) : undefined;

  return (
    <section
      ref={rootRef}
      id={CURRICULUM_SECTION_ID}
      aria-labelledby={headingId}
      data-testid="curriculum"
      className="flex flex-col gap-3 pt-1"
    >
      <div className="flex items-baseline justify-between gap-3">
        <SectionTitle id={headingId} variant="group" className={SECTION_TITLE}>
          {t('courses.curriculum.title')}
        </SectionTitle>
        {draft.length > 0 ? (
          <span
            data-testid="curriculum-count"
            className="shrink-0 text-xs font-normal text-text-tertiary tabular-nums"
          >
            {t('courses.row.meta', { modules: draft.length, lessons: lessonTotal })}
          </span>
        ) : null}
      </div>

      {draft.length === 0 ? (
        <EmptyState
          variant="card"
          icon={Layers}
          data-testid="curriculum-empty"
          title={t('courses.curriculum.empty.title')}
          body={t('courses.curriculum.empty.body')}
          action={
            <Button
              type="button"
              variant="outline"
              size="md"
              data-curriculum-empty-create
              onClick={() => openSheet({ mode: 'new' })}
            >
              {t('courses.curriculum.empty.cta')}
            </Button>
          }
        />
      ) : (
        <ReorderList
          items={draft.map((module) => ({ ...module, name: module.title }))}
          onChange={(ids) => void moveModules(ids)}
          disabled={savingModules}
          label={t('courses.reorder.lists.modules', { course: courseTitle })}
          labels={labels}
          className="flex flex-col gap-4"
          testId="curriculum-modules"
          arrowClassName={MODULE_BAND_CONTROL}
          renderItem={(module, arrows, index) => {
            const position = index + 1;
            const view = moduleCardView(module, position, t as never);
            return (
              <FadeIn>
                <ModuleCard
                  id={module.id}
                  position={position}
                  positionLabel={view.positionLabel}
                  numeral={view.numeral}
                  pillLabel={view.pillLabel}
                  title={module.title}
                  requiresPreviousLabel={view.requiresPreviousLabel}
                  meta={view.meta}
                  art={art}
                  arrows={arrows}
                  editLabel={view.editLabel}
                  onEdit={() => openSheet({ mode: 'edit', module, position })}
                >
                  {module.lessons.length > 0 ? (
                    <ReorderList
                      items={module.lessons.map((lesson) => ({ ...lesson, name: lesson.title }))}
                      onChange={(ids) => void moveLessons(module.id, ids)}
                      disabled={savingLessons[module.id] === true}
                      label={t('courses.reorder.lists.lessons', { module: module.title })}
                      labels={labels}
                      className="flex flex-col divide-y divide-divider"
                      testId="curriculum-lessons"
                      renderItem={(lesson, lessonArrows) => (
                        <LessonRowHost
                          lesson={lesson}
                          courseId={courseId}
                          thumbnailUrl={thumbnails[lesson.id]}
                          arrows={lessonArrows}
                        />
                      )}
                    />
                  ) : (
                    <p
                      data-testid="curriculum-no-lessons"
                      className="flex min-h-11 items-center px-3.5 text-sm font-normal text-text-tertiary"
                    >
                      {t('courses.curriculum.noLessons')}
                    </p>
                  )}
                  <a
                    href={newLessonHref(courseId, module.id)}
                    data-testid="curriculum-new-lesson"
                    className={`${NEW_LESSON} border-t border-divider`}
                  >
                    <Plus aria-hidden size={15} className="shrink-0" />
                    {t('courses.curriculum.newLesson')}
                  </a>
                </ModuleCard>
              </FadeIn>
            );
          }}
        />
      )}

      {/* "Novo módulo" closes the list, a dashed block (the prototype's); the empty state has its own. */}
      {draft.length > 0 ? (
        <Button
          type="button"
          variant="outline"
          size="md"
          data-curriculum-create
          className={DASHED_OVERRIDES}
          onClick={() => openSheet({ mode: 'new' })}
        >
          <Plus aria-hidden size={16} className="shrink-0" />
          {t('courses.curriculum.newModule')}
        </Button>
      ) : null}

      {sheet ? (
        <ModuleSheet
          key={sheetKey}
          open={open}
          mode={sheet.mode}
          courseId={courseId}
          module={sheet.mode === 'edit' ? sheet.module : null}
          position={sheet.mode === 'edit' ? sheet.position : draft.length + 1}
          onClose={closeSheet}
          onCreated={onCreated}
          onUpdated={onUpdated}
          onRemoved={onRemoved}
        />
      ) : null}
    </section>
  );
}

/**
 * One lesson row with its readiness poll: a pending/processing video is re-read on the hook's
 * backoff and, once it settles (`ready` or `failed`), the page refreshes so the next render mints
 * the poster or draws the `Camera`. Settled lessons poll nothing.
 */
function LessonRowHost({
  lesson,
  courseId,
  thumbnailUrl,
  arrows,
}: {
  lesson: LessonView;
  courseId: string;
  thumbnailUrl: string | undefined;
  arrows: React.ReactNode;
}) {
  const t = useTranslations();
  const router = useRouter();
  const polling = lesson.videoStatus === 'pending' || lesson.videoStatus === 'processing';
  const readiness = useAssetReadiness(polling ? lesson.videoAssetId : null);
  const settled = readiness.phase === 'ready' || readiness.phase === 'failed';
  const refreshed = useRef(false);

  useEffect(() => {
    if (!polling || !settled || refreshed.current) return;
    refreshed.current = true;
    router.refresh();
  }, [polling, settled, router]);

  const view = lessonRowView(lesson, courseId, t as never, thumbnailUrl);
  return (
    <LessonRow
      id={view.id}
      href={view.href}
      title={view.title}
      meta={view.meta}
      thumb={view.thumb}
      pill={view.pill}
      ariaLabel={view.ariaLabel}
      requiresPreviousLabel={view.requiresPreviousLabel}
      trailing={arrows}
    />
  );
}
