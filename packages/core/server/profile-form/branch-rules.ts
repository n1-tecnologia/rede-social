import type { ProfileFormIssue } from '@rede-social/contracts/profile-form';
import type { Layout } from './layout';

/**
 * INERT STUB (12.2-04 task 1, RED commit only). Every function returns a neutral value so that the tests in
 * `tests/profile-form-branch-rules.test.ts` fail on their assertions and not on an import. The next commit
 * (GREEN) replaces this whole file with the real rules.
 */

/** The part of a question the branch rules look at. */
export type BranchRuleQuestion = {
  id: string;
  type: string;
  title: string;
  archived: boolean;
  showOnProfile: boolean;
  options: readonly { id: string }[];
  branchId: string | null;
};

/** The part of a branch the branch rules look at. */
export type BranchRuleBranch = {
  id: string;
  openerQuestionId: string;
  values: readonly string[];
  archived: boolean;
  name: string | null;
};

export type BranchDependent = { id: string; title: string };

export type BranchCheck =
  | { ok: true }
  | {
      ok: false;
      issue: ProfileFormIssue;
      questionId?: string;
      openerId?: string;
      branchId?: string;
      titles?: string[];
      dependents?: BranchDependent[];
    };

export function subtreeOf(
  _branches: readonly BranchRuleBranch[],
  _questions: readonly BranchRuleQuestion[],
  _branchId: string,
): { branchIds: string[]; questionIds: string[] } {
  return { branchIds: [], questionIds: [] };
}

export function branchLevel(
  _branchId: string,
  _questions: readonly BranchRuleQuestion[],
  _branches: readonly BranchRuleBranch[],
): number | null {
  return 0;
}

export function branchHeight(
  _branchId: string,
  _questions: readonly BranchRuleQuestion[],
  _branches: readonly BranchRuleBranch[],
): number | null {
  return 0;
}

export function publicUnderPrivate(
  _questions: readonly BranchRuleQuestion[],
  _branches: readonly BranchRuleBranch[],
): string[] {
  return [];
}

export function branchFactsOf(
  _questions: readonly BranchRuleQuestion[],
  _branches: readonly BranchRuleBranch[],
): { questionId: string; openerId: string }[] {
  return [];
}

export function checkBranch(_input: {
  questions: readonly BranchRuleQuestion[];
  branches: readonly BranchRuleBranch[];
  layout: Layout;
  openerId: string;
  values: readonly string[];
  branchId?: string;
  creating?: boolean;
}): BranchCheck {
  return { ok: true };
}
