import { z } from 'zod';

/**
 * RED stub (08.7-11 Task 1): the owner's Atendimento contract does not exist yet. Every schema
 * accepts nothing, so the contract test fails on its assertions until the GREEN commit writes the
 * real shapes.
 */
export const SUPPORT_WEEKS = 0;
export const supportPayloadSchema = z.never();
export const ownerSupportReadySchema = z.never();
export const ownerSupportAnswerSchema = z.never();
export type SupportPayload = z.infer<typeof supportPayloadSchema>;
export type OwnerSupportReady = z.infer<typeof ownerSupportReadySchema>;
export type OwnerSupportAnswer = z.infer<typeof ownerSupportAnswerSchema>;
