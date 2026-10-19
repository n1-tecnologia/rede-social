import { z } from 'zod';

/**
 * RED stub (08.7-09 Task 1): the owner's Financeiro contract is not written yet. Every schema accepts
 * nothing and the constants are empty, so the contract tests fail on their assertions.
 */
export const FINANCE_STALLED_DAYS = 0;
export const FINANCE_BUYER_LISTS = [] as const;
export const financePayloadSchema = z.never();
export type FinancePayload = Record<string, unknown> & {
  [key: string]: unknown;
};
export const ownerFinanceAnswerSchema = z.never();
