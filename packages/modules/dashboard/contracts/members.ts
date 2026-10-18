import { z } from 'zod';

/**
 * INERT STUB (08.7-02 TDD RED): the owner's "Membros" contract does not exist yet. Every schema here
 * is `z.never()`, so `tests/members-contract.test.ts` fails on its assertions, not on an import.
 * The GREEN commit replaces this file with the real schemas.
 */
export const ENGAGEMENT_BANDS = [] as const;
export const engagementBandSchema = z.never();
export const engagementBandsSchema = z.never();
export const bandMovementSchema = z.never();
export const cohortRowSchema = z.never();
export const communityEngagementSchema = z.never();
export const eventEngagementSchema = z.never();
export const membersPayloadSchema = z.never();
export const ownerMembersAnswerSchema = z.never();
