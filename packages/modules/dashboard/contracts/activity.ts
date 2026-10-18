import { z } from 'zod';

/**
 * 08.7-03 RED STUB (inert, replaced in the GREEN commit): the member's "Sua atividade" contract.
 * Accepts nothing, so every "parses" case fails on its assertion and the "rejects" cases pass
 * trivially until the real schemas land.
 */
export const memberActivityPayloadSchema = z.never();
export const memberActivityAnswerSchema = z.never();
export type MemberActivityAnswer = z.infer<typeof memberActivityAnswerSchema>;
