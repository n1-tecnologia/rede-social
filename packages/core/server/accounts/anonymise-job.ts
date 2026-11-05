import type { AccountDeletedMailInput } from '../mail/index';

/**
 * RED skeleton (13-13 task 2): the types and the entry point exist so the failing tests fail on behaviour. The
 * real job replaces this file in the GREEN commit.
 */

export const ANONYMISE_DUE_QUEUE = 'accounts.anonymise-due';

export type DueMember = { membershipId: string; userId: string; tenantId: string };

export type AnonymiseDeps = {
  listDue(limit: number): Promise<DueMember[]>;
  tenantFacts(
    tenantId: string,
  ): Promise<{ brand: AccountDeletedMailInput['brand']; timeZone: string }>;
  getAuthUser(userId: string): Promise<{ email: string } | null>;
  sendMail(to: string, input: AccountDeletedMailInput): Promise<void>;
  hasOtherMemberships(member: DueMember): Promise<boolean>;
  softDeleteAuthUser(userId: string): Promise<void>;
  anonymise(membershipId: string): Promise<boolean>;
  scrubMirrors(): Promise<number>;
  rearm(): Promise<void>;
  now(): Date;
  warn(fields: Record<string, unknown>): void;
};

export type AnonymiseResult = {
  due: number;
  anonymised: number;
  mailed: number;
  keptIdentity: number;
  failed: number;
};

export async function runAnonymiseDue(_deps: AnonymiseDeps): Promise<AnonymiseResult> {
  return { due: 0, anonymised: 0, mailed: 0, keptIdentity: 0, failed: 0 };
}
