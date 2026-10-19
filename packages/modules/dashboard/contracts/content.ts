import { z } from 'zod';

/**
 * RED stub (08.7-06 Task 1): the Conteúdo contract is not written yet. Empty constants and schemas
 * that accept nothing, so the RED tests fail on their assertions, not on an import.
 */
export const CONTENT_KINDS: readonly string[] = [];
export const HEATMAP_SLOTS: readonly (readonly [number, number])[] = [];
export const CONTENT_VELOCITY_HOURS: readonly number[] = [];
export const contentPayloadSchema = z.never();
export const ownerContentAnswerSchema = z.never();
