import type { LessonLockReason, ModuleLockReason } from './index';

/**
 * The member curriculum's lock LABELS (08.5-07, UI-D-430, R-Pattern 3, UI-D-445): the prototype's
 * `resolveLock` reduced to its one safe half. The server's evaluator (`app.course_lesson_states`)
 * decides every lock and sends its `lockReason`; this formatter only says it in words. It takes the
 * reason and the module number in, and hands back a catalog KEY and its values — never a word, never
 * a decision: no clock, no storage, no progress arithmetic. A web that computed a lock here could be
 * argued with by a tampered URL; a web that only labels the server's answer cannot (D-428).
 *
 * Keys are FULL (`courses.member.…`), the shape every `lib/*-view` translator takes. Module numbers
 * are the two-digit form the member surfaces print ("Módulo 01").
 */

/** One label: the catalog key and the values its placeholders take. */
export interface LockLabel {
  key: string;
  values: Record<string, string>;
}

/** "1" → "01": the two-digit module and lesson numbers of the member surfaces. */
export function padNumber(value: number): string {
  const n = Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1;
  return String(n).padStart(2, '0');
}

export interface LessonLockInput {
  /** The server's reason; null is an open lesson (no label). */
  lockReason: LessonLockReason | null;
  /**
   * The number of the module whose completion opens this lesson — the module BEFORE the lesson's
   * own (`module.number - 1`). Read only for the `module` reason.
   */
  previousModuleNumber?: number;
  /**
   * The lesson's already-formatted length ("12:34", or "Prática" without a video), printed in front
   * of "Aula exclusiva" for the `purchase` reason. Empty when unknown.
   */
  duration?: string;
}

/**
 * A lesson row's lock meta (UI-D-430): `purchase` → "{duration} · Aula exclusiva", `lesson` →
 * "Libera ao concluir a aula anterior", `module` → "Libera ao concluir o Módulo {nn}"; null when open.
 */
export function lessonLockLabel({
  lockReason,
  previousModuleNumber,
  duration,
}: LessonLockInput): LockLabel | null {
  switch (lockReason) {
    case 'purchase':
      return { key: 'courses.member.lesson.exclusive', values: { duration: duration ?? '' } };
    case 'lesson':
      return { key: 'courses.member.lesson.lockedByPrevious', values: {} };
    case 'module':
      return {
        key: 'courses.member.lesson.lockedByModule',
        values: { nn: padNumber(previousModuleNumber ?? 1) },
      };
    default:
      return null;
  }
}

export interface ModuleLockInput {
  lockReason: ModuleLockReason | null;
  /** The number of the module before this one (`module.number - 1`). */
  previousModuleNumber?: number;
}

/**
 * A module band's lock meta (UI-D-429): only the MODULE rule replaces the band's meta, with "Libera
 * ao concluir o Módulo {nn}". A band held by the course purchase keeps its "{N} aulas · {duration}"
 * meta (the buy section above says why), so `purchase` — like an open module — has no label here.
 */
export function moduleLockLabel({
  lockReason,
  previousModuleNumber,
}: ModuleLockInput): LockLabel | null {
  if (lockReason !== 'module') return null;
  return {
    key: 'courses.member.module.lockedBy',
    values: { nn: padNumber(previousModuleNumber ?? 1) },
  };
}
