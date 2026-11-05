'use client';

import { MEMBER_CARD, MemberLessonRow, ModuleCover } from '@rede-social/module-courses/ui';
import { Card, cn } from '@rede-social/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import type { ModuleBandView } from '@/lib/courses-member-view';

/**
 * The member curriculum (08.5-07, UI-D-429, UI-D-430, D-423): one `<section>` per live module — the
 * `ModuleCover` band as the accordion's button and, expanded, a card holding the module's
 * `MemberLessonRow`s in an `<ol>` named by the module title.
 *
 * **Client only for the open set.** It starts from `initialOpen` (the server's
 * `curriculumOpenModules`, the UI-D-429 rule), with the focus left on the band the member pressed. A
 * band is never disabled: a locked module opens like any other and its rows say, in words, why each
 * lesson is held.
 *
 * **2026-10-22 (the courses area redesign on the social-igoralves prototype).** The list opens and
 * closes like the prototype's: height and opacity over 0.2 s (`motion/react`), the bands that start
 * open render open with no animation (`initial={false}`), and under "reduzir movimento" the toggle is
 * instant again (`useReducedMotion`). The lessons sit in the area's outlined card.
 *
 * **Titles only** (D-423, T-08.5-13): every row view arrives finished from the server and carries a
 * title, a meta in words, a state and an href — never a description, a video, a poster or a
 * material. A locked row is still a link (A-UI-3): the lesson URL answers with the lock page.
 */
export interface CurriculumProps {
  modules: ModuleBandView[];
  initialOpen: string[];
  /** The course cover: every band and thumb crops this one asset (R-A10). */
  coverAssetId: string | null;
  coverWidths: readonly number[];
}

export function Curriculum({ modules, initialOpen, coverAssetId, coverWidths }: CurriculumProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initialOpen));
  const reduce = useReducedMotion();

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div data-testid="curriculum" className="flex flex-col gap-3 px-4">
      {modules.map((module) => {
        const expanded = open.has(module.id);
        const listId = `module-lessons-${module.id}`;
        return (
          <section key={module.id} data-testid="curriculum-module" data-module-id={module.id}>
            <ModuleCover
              id={module.id}
              ariaLabel={module.ariaLabel}
              expanded={expanded}
              controlsId={listId}
              onToggle={() => toggle(module.id)}
              numeral={module.numeral}
              pill={module.pill}
              title={module.title}
              meta={module.meta}
              metaLocked={module.metaLocked}
              state={module.state}
              coverAssetId={coverAssetId}
              coverWidths={coverWidths}
            />
            <AnimatePresence initial={false}>
              {expanded ? (
                <motion.div
                  key="lessons"
                  data-testid="curriculum-lessons-panel"
                  initial={reduce ? false : { height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={
                    reduce ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0 }
                  }
                  transition={{ duration: reduce ? 0 : 0.2, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <Card className={cn(MEMBER_CARD, 'ms-panel ms-solid mt-2 rounded-2xl p-1.5')}>
                    <ol
                      id={listId}
                      aria-label={module.title}
                      data-testid="curriculum-lessons"
                      className="flex flex-col gap-1"
                    >
                      {module.lessons.map((lesson) => (
                        <li key={lesson.id}>
                          <MemberLessonRow
                            id={lesson.id}
                            href={lesson.href}
                            ariaLabel={lesson.ariaLabel}
                            title={lesson.title}
                            meta={lesson.meta}
                            metaLocked={lesson.metaLocked}
                            trailing={lesson.trailing}
                            thumbState={lesson.thumbState}
                            resumePercent={lesson.resumePercent}
                            current={lesson.current}
                            coverAssetId={coverAssetId}
                            coverWidths={coverWidths}
                          />
                        </li>
                      ))}
                    </ol>
                  </Card>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </section>
        );
      })}
    </div>
  );
}
