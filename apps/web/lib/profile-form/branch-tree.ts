import type { AdminBranch, AdminQuestion, AdminStep } from '@rede-social/contracts/profile-form';
import type { BranchTree as ChainTree } from '@rede-social/contracts/profile-form-branches';

/**
 * The builder's branch tree (12.2-13, D-641, D-642, D-643, D-644, D-649). RED stub: the types are final,
 * every function is deliberately inert and is replaced in full by the GREEN commit of the same task.
 */

/** The admin read the tree is built from. `branches` is absent in a form that has none. */
export type AdminTreeInput = {
  steps: readonly AdminStep[];
  questions: readonly AdminQuestion[];
  branches?: readonly AdminBranch[] | undefined;
};

/** How many ACTIVE questions a branch holds: its own, and its own plus those of every branch below it. */
export type BranchCounts = { direct: number; subtree: number };

/** One question of the Lista with the branch runs that hang on it in the step. */
export type QuestionNode = {
  question: AdminQuestion;
  /** The global number 1..N, in the order members see the questions. */
  number: number;
  /** The branch runs under this opener in the step, in the order the Lista draws them. */
  branches: BranchRun[];
};

/** A branch's questions in ONE step (a branch whose questions sit in several steps has a run per step). */
export type BranchRun = {
  branch: AdminBranch;
  stepId: string;
  /** The branch level, 1 to `branchDepth`. */
  level: number;
  /** The rails drawn in this step (a run whose opener is in another step sits at the root, so 1). */
  depth: number;
  /** True when the opener is NOT in this step: the strip says where the deciding question is. */
  openerInOtherStep: boolean;
  /** True when the branch holds no active question at all. */
  empty: boolean;
  questions: QuestionNode[];
  counts: BranchCounts;
};

/** What sits at the root of a step: an unconditional question, or a run whose opener is in another step. */
export type StepRoot = { kind: 'question'; node: QuestionNode } | { kind: 'run'; run: BranchRun };

export type StepNode = { step: AdminStep; roots: StepRoot[] };

export type AdminBranchTree = {
  steps: readonly AdminStep[];
  /** The ACTIVE questions in stored order. */
  questions: readonly AdminQuestion[];
  /** Every branch of the read, in list order. */
  branches: readonly AdminBranch[];
  questionById: ReadonlyMap<string, AdminQuestion>;
  branchById: ReadonlyMap<string, AdminBranch>;
  /** The question ids in the order members see them: steps in order, then stored order inside a step. */
  flatIds: readonly string[];
  flatIndex: ReadonlyMap<string, number>;
  /** Step id to its 1-based place among the steps. */
  stepOrdinal: ReadonlyMap<string, number>;
  /** The contracts' lookups, the one input of the chain rule. */
  chain: ChainTree;
};

export function buildBranchTree(input: AdminTreeInput): AdminBranchTree {
  return {
    steps: input.steps,
    questions: input.questions,
    branches: input.branches ?? [],
    questionById: new Map(),
    branchById: new Map(),
    flatIds: [],
    flatIndex: new Map(),
    stepOrdinal: new Map(),
    chain: { branch: () => undefined, branchIdOf: () => undefined },
  };
}

export function stepTree(_tree: AdminBranchTree, _stepId: string): StepNode | null {
  return null;
}

/** The branches from `branchId` up to the top, the branch itself first; `null` when the chain cannot be walked. */
export function branchChain(_tree: AdminBranchTree, _branchId: string): AdminBranch[] | null {
  return null;
}

/** The level of a branch: the length of its chain (a branch on a root question is 1). */
export function branchLevel(_tree: AdminBranchTree, _branchId: string): number | null {
  return null;
}

/** The height of a branch: the longest run of nested branches below it, counting itself (no branch below is 1). */
export function branchHeight(_tree: AdminBranchTree, _branchId: string): number | null {
  return null;
}

export function countsOf(_tree: AdminBranchTree, _branchId: string): BranchCounts {
  return { direct: 0, subtree: 0 };
}

/** "Abre N": the ACTIVE questions in the active branches that hang directly on this opener. */
export function opensCountOf(_tree: AdminBranchTree, _questionId: string): number {
  return 0;
}

/** For an opener, how many active branches name each answer token (an option id, or 'true' / 'false'). */
export function referencedOptionCounts(
  _tree: AdminBranchTree,
  _questionId: string,
): Map<string, number> {
  return new Map();
}
