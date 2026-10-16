import type { Tx } from '@rede-social/core/db/tenant-tx';
import type { JobDefinition } from '@rede-social/core/server/modules/manifest';
import { COURSES_QUEUES, type LessonsBatchJob } from '../contracts/index';

/**
 * RED STUB (08.6-07 Task 3, TDD): the lessons batch (D-450) is declared with inert bodies; the GREEN
 * commit replaces them with the arming, the claim and the emit.
 */

export type LessonsBatchClaim = {
  claimed: number;
  pending: number;
  oldestPendingAt: string | null;
};

export function lessonsBatchPlan(
  _claim: LessonsBatchClaim,
  _nowMs: number,
): { emit: boolean; rearm: boolean } {
  return { emit: false, rearm: false };
}

export async function armLessonsBatch(
  _tx: Tx,
  _input: LessonsBatchJob,
  _nowMs: number = Date.now(),
): Promise<void> {}

export async function runLessonsBatch(
  _raw: unknown,
  _nowMs: number,
): Promise<'emitted' | 'skipped' | 'dropped'> {
  return 'dropped';
}

export const lessonsBatchJob: JobDefinition<LessonsBatchJob> = {
  name: COURSES_QUEUES.lessonsBatch,
  handler: (payload) => runLessonsBatch(payload, Date.now()).then(() => undefined),
};
