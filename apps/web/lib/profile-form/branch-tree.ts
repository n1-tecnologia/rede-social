import {
  type AdminBranch,
  type AdminQuestion,
  type AdminStep,
  PROFILE_FORM_CONDITION_OPENER_TYPES,
  PROFILE_FORM_LIMITS,
  type ProfileFormType,
} from '@rede-social/contracts/profile-form';
import {
  branchChainOf,
  branchTreeOf,
  type BranchTree as ChainTree,
} from '@rede-social/contracts/profile-form-branches';

/**
 * The builder's branch tree (12.2-13, D-641, D-642, D-643, D-644, D-649): everything the Lista, the Fluxo and
 * the sheets need, derived on the client from the ONE admin read (steps, questions with their `branchId`,
 * branches). No second implementation of visibility lives here: the chain of a branch is the contracts'
 * `branchChainOf`, and a branch that is archived is simply not part of what the builder draws.
 *
 * Only the admin lane calls this module: a branch NAME exists only in the admin shapes (T-12.2-03), and no
 * function here reads an answer. Counts, ids, titles and labels are all that leave it (T-12.2-14).
 */

import { type BranchDescription, describeBranch } from './describe-branch';

/** The longest chain of branches above a question (the contracts' limit, D-644). */
const MAX_LEVEL = PROFILE_FORM_LIMITS.branchDepth;

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
  /** Every branch of the read by its opener question, in list order (archived ones included). */
  branchesByOpener: ReadonlyMap<string, readonly AdminBranch[]>;
  /** The question ids in the order members see them: steps in order, then stored order inside a step. */
  flatIds: readonly string[];
  flatIndex: ReadonlyMap<string, number>;
  /** Step id to its 1-based place among the steps. */
  stepOrdinal: ReadonlyMap<string, number>;
  /** The contracts' lookups, the one input of the chain rule. */
  chain: ChainTree;
};

export function buildBranchTree(input: AdminTreeInput): AdminBranchTree {
  const branches = input.branches ?? [];
  const questionById = new Map(input.questions.map((question) => [question.id, question]));
  const branchById = new Map(branches.map((branch) => [branch.id, branch]));
  const branchesByOpener = new Map<string, AdminBranch[]>();
  for (const branch of branches) {
    const list = branchesByOpener.get(branch.openerQuestionId) ?? [];
    list.push(branch);
    branchesByOpener.set(branch.openerQuestionId, list);
  }
  const stepOrdinal = new Map(input.steps.map((step, index) => [step.id, index + 1]));
  // Steps in order, the questions of a step in stored order; a question of an unknown step comes last.
  const flatIds: string[] = [];
  for (const step of input.steps) {
    for (const question of input.questions) {
      if (question.stepId === step.id) flatIds.push(question.id);
    }
  }
  for (const question of input.questions) {
    if (!stepOrdinal.has(question.stepId)) flatIds.push(question.id);
  }
  return {
    steps: input.steps,
    questions: input.questions,
    branches,
    questionById,
    branchById,
    branchesByOpener,
    flatIds,
    flatIndex: new Map(flatIds.map((id, index) => [id, index])),
    stepOrdinal,
    chain: branchTreeOf(input.questions, branches),
  };
}

// ── What the builder draws: only ACTIVE (not archived) branches ───────────────────────────────────

/** A branch the builder draws: known and not archived. */
export function usableBranch(tree: AdminBranchTree, branchId: string | null | undefined) {
  if (branchId === null || branchId === undefined) return undefined;
  const branch = tree.branchById.get(branchId);
  return branch !== undefined && branch.archivedAt === null ? branch : undefined;
}

/** The ACTIVE questions that sit directly in a branch, in stored order. */
export function membersOf(tree: AdminBranchTree, branchId: string): AdminQuestion[] {
  return tree.questions.filter((question) => question.branchId === branchId);
}

/** The usable branches that hang on an opener, in list order. */
export function usableBranchesOf(tree: AdminBranchTree, openerId: string): AdminBranch[] {
  return (tree.branchesByOpener.get(openerId) ?? []).filter((branch) => branch.archivedAt === null);
}

/**
 * The usable branches of an opener in the order members meet them: by the flat position of their first
 * question, the empty ones last in list order (D-642, D-652).
 */
export function orderedBranchesOf(tree: AdminBranchTree, openerId: string): AdminBranch[] {
  const keyed = usableBranchesOf(tree, openerId).map((branch, listIndex) => {
    const first = Math.min(
      ...membersOf(tree, branch.id).map(
        (member) => tree.flatIndex.get(member.id) ?? Number.MAX_SAFE_INTEGER,
      ),
    );
    return { branch, listIndex, first };
  });
  const filled = keyed.filter((item) => Number.isFinite(item.first));
  const empty = keyed.filter((item) => !Number.isFinite(item.first));
  filled.sort((a, b) => a.first - b.first || a.listIndex - b.listIndex);
  return [...filled, ...empty].map((item) => item.branch);
}

/** How many ACTIVE questions a branch holds directly, and in the whole subtree below it. */
export function countsOf(tree: AdminBranchTree, branchId: string): BranchCounts {
  const direct = membersOf(tree, branchId).length;
  const seen = new Set<string>([branchId]);
  let subtree = direct;
  let frontier = [branchId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const member of membersOf(tree, id)) {
        for (const below of usableBranchesOf(tree, member.id)) {
          if (seen.has(below.id)) continue;
          seen.add(below.id);
          subtree += membersOf(tree, below.id).length;
          next.push(below.id);
        }
      }
    }
    frontier = next;
  }
  return { direct, subtree };
}

/** "Abre N": the ACTIVE questions in the usable branches that hang directly on this opener. */
export function opensCountOf(tree: AdminBranchTree, questionId: string): number {
  return usableBranchesOf(tree, questionId).reduce(
    (total, branch) => total + membersOf(tree, branch.id).length,
    0,
  );
}

/** For an opener, how many usable branches name each answer token (an option id, or 'true' / 'false'). */
export function referencedOptionCounts(
  tree: AdminBranchTree,
  questionId: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const branch of usableBranchesOf(tree, questionId)) {
    for (const value of new Set(branch.values)) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

// ── The chain, the level and the height of a branch (D-644) ───────────────────────────────────────

/**
 * The branches from `branchId` up to the top, the branch itself first (`[B3, B2, B1]`). `null` for an unknown
 * branch or opener, a cycle or a chain over the limit: the contracts' own walk, never a second one.
 */
export function branchChain(tree: AdminBranchTree, branchId: string): AdminBranch[] | null {
  const chain = branchChainOf(branchId, tree.chain);
  if (chain === null) return null;
  const found: AdminBranch[] = [];
  for (const def of chain) {
    const branch = tree.branchById.get(def.id);
    if (branch === undefined) return null;
    found.push(branch);
  }
  return found;
}

/** The level of a branch: the length of its chain (a branch on a root question is 1). */
export function branchLevel(tree: AdminBranchTree, branchId: string): number | null {
  return branchChain(tree, branchId)?.length ?? null;
}

/**
 * The height of a branch: the longest run of nested branches below it, counting itself (none below is 1).
 * `null` for an unknown branch or a cycle; stops at the limit plus one, enough to say "over". Mirrors the
 * server rule of `branch-rules.ts` for the screen's pre-check; the server stays the authority.
 */
export function branchHeight(tree: AdminBranchTree, branchId: string): number | null {
  if (!tree.branchById.has(branchId)) return null;
  const seen = new Set<string>([branchId]);
  let frontier = new Set<string>([branchId]);
  let height = 1;
  while (height <= MAX_LEVEL) {
    const next = new Set<string>();
    for (const branch of tree.branches) {
      const holder = tree.questionById.get(branch.openerQuestionId)?.branchId ?? null;
      if (holder === null || !frontier.has(holder)) continue;
      if (seen.has(branch.id)) return null;
      seen.add(branch.id);
      next.add(branch.id);
    }
    if (next.size === 0) return height;
    height += 1;
    frontier = next;
  }
  return height;
}

// ── The Lista: the tree of one step ───────────────────────────────────────────────────────────────

/**
 * The structure the Lista draws for one step (UI-D-666): the root questions in stored order, under each
 * opener the branches that have a run in the step (a run per step for a branch whose questions sit in
 * several steps, D-643), nested to three levels. A run whose opener is in another step sits among the roots,
 * at the place of its first question. Every active question of the step appears exactly once, even in a
 * stored tree that has a cycle or a branch that cannot be walked. `null` for an unknown step.
 */
export function stepTree(tree: AdminBranchTree, stepId: string): StepNode | null {
  const step = tree.steps.find((candidate) => candidate.id === stepId);
  if (step === undefined) return null;
  const inStep = tree.questions.filter((question) => question.stepId === stepId);
  const indexInStep = new Map(inStep.map((question, index) => [question.id, index]));
  const placed = new Set<string>();

  const membersInStep = (branchId: string) =>
    inStep.filter((question) => question.branchId === branchId);

  /** The branches to draw under an opener in this step, in the order the Lista draws them. */
  const branchesUnder = (opener: AdminQuestion): AdminBranch[] => {
    const keyed = usableBranchesOf(tree, opener.id).map((branch, listIndex) => {
      const here = membersInStep(branch.id);
      const first = here.length === 0 ? -1 : (indexInStep.get(here[0]?.id ?? '') ?? -1);
      const empty = membersOf(tree, branch.id).length === 0;
      return { branch, listIndex, first, here: here.length, empty };
    });
    const filled = keyed.filter((item) => item.here > 0);
    filled.sort((a, b) => a.first - b.first || a.listIndex - b.listIndex);
    const empties = keyed.filter((item) => item.empty && opener.stepId === stepId);
    return [...filled, ...empties].map((item) => item.branch);
  };

  const makeNode = (question: AdminQuestion, depth: number, path: ReadonlySet<string>) => {
    placed.add(question.id);
    const branches: BranchRun[] = [];
    if (depth < MAX_LEVEL) {
      for (const branch of branchesUnder(question)) {
        if (path.has(branch.id)) continue;
        const run = makeRun(branch, depth + 1, new Set([...path, branch.id]), false);
        if (run !== null) branches.push(run);
      }
    }
    const node: QuestionNode = {
      question,
      number: (tree.flatIndex.get(question.id) ?? 0) + 1,
      branches,
    };
    return node;
  };

  const makeRun = (
    branch: AdminBranch,
    depth: number,
    path: ReadonlySet<string>,
    foreign: boolean,
  ): BranchRun | null => {
    const empty = membersOf(tree, branch.id).length === 0;
    const members = membersInStep(branch.id).filter((member) => !placed.has(member.id));
    if (members.length === 0 && !empty) return null;
    const questions = members.map((member) => makeNode(member, depth, path));
    return {
      branch,
      stepId,
      level: branchLevel(tree, branch.id) ?? depth,
      depth,
      openerInOtherStep: foreign,
      empty,
      questions,
      counts: countsOf(tree, branch.id),
    };
  };

  // The units of the root, each keyed by the stored position of its first question.
  type Unit = { key: number; build: () => StepRoot | null };
  const units: Unit[] = [];
  for (const question of inStep) {
    if (usableBranch(tree, question.branchId) !== undefined) continue;
    units.push({
      key: indexInStep.get(question.id) ?? 0,
      build: () => ({
        kind: 'question',
        node: makeNode(question, 0, new Set()),
      }),
    });
  }
  const seenForeign = new Set<string>();
  for (const question of inStep) {
    const branch = usableBranch(tree, question.branchId);
    if (branch === undefined || seenForeign.has(branch.id)) continue;
    const opener = tree.questionById.get(branch.openerQuestionId);
    if (opener !== undefined && opener.stepId === stepId) continue;
    seenForeign.add(branch.id);
    units.push({
      key: indexInStep.get(question.id) ?? 0,
      build: () => {
        const run = makeRun(branch, 1, new Set([branch.id]), true);
        return run === null ? null : { kind: 'run', run };
      },
    });
  }
  units.sort((a, b) => a.key - b.key);

  const roots: StepRoot[] = [];
  for (const unit of units) {
    const root = unit.build();
    if (root !== null) roots.push(root);
  }
  // A question the walk could not reach (a stored cycle) is drawn as a root, never dropped.
  for (const question of inStep) {
    if (!placed.has(question.id)) {
      roots.push({ kind: 'question', node: makeNode(question, 0, new Set()) });
    }
  }
  return { step, roots };
}

// ── Client pre-checks: what the screen offers, the server stays the authority (D-644, D-646) ──────────

/** The part of a question the "Ramo" select needs; `id` is `null` for a question not saved yet. */
export type EligibilityQuestion = {
  id: string | null;
  /** The switch "Mostrar no perfil do membro" as it stands now (WR-06). */
  showOnProfile: boolean;
  /** The step a NEW question is going into: it lands at the end of that step. Absent means the end of the form. */
  stepId?: string | null;
};

/** The question and every question below it, through any branch (archived ones included, like the server). */
function descendantsOf(tree: AdminBranchTree, questionId: string): Set<string> {
  const seen = new Set<string>([questionId]);
  let frontier = [questionId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const branch of tree.branchesByOpener.get(id) ?? []) {
        for (const member of membersOf(tree, branch.id)) {
          if (seen.has(member.id)) continue;
          seen.add(member.id);
          next.push(member.id);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

/** Whether any opener on the chain of `branchId` does not show on the member profile (WR-06, PF009). */
function chainHasPrivateOpener(tree: AdminBranchTree, branchId: string): boolean {
  const chain = branchChain(tree, branchId);
  if (chain === null) return false;
  return chain.some((branch) => {
    const opener = tree.questionById.get(branch.openerQuestionId);
    return opener !== undefined && !opener.showOnProfile;
  });
}

/**
 * The flat position a question is judged at: its own place when it is saved, else the end of the step it is
 * going into (a new question lands at the end of the step, D-646), else the end of the form.
 */
function positionOf(tree: AdminBranchTree, question: EligibilityQuestion): number {
  const own = question.id === null ? undefined : tree.flatIndex.get(question.id);
  if (own !== undefined) return own;
  const ordinal = question.stepId == null ? undefined : tree.stepOrdinal.get(question.stepId);
  if (ordinal === undefined) return tree.flatIds.length;
  return tree.flatIds.filter((id) => {
    const step = tree.questionById.get(id)?.stepId;
    return step !== undefined && (tree.stepOrdinal.get(step) ?? Number.MAX_SAFE_INTEGER) <= ordinal;
  }).length;
}

/**
 * The ACTIVE branches a question may be placed in (UI-D-669), the screen's twin of `checkMoveIntoBranch`
 * (the server is the authority and revalidates): the opener comes strictly BEFORE the question in the
 * flattened form (D-641), is not the question or one of its own descendants, the branch's level plus the
 * height of the question's own sub-branches stays within `PROFILE_FORM_LIMITS.branchDepth` (D-644), and, for a
 * public question, no opener on the branch's chain is private (UI-D-675). `leftOutForPrivacy` is true when at
 * least one branch was left out ONLY for that last reason, so the screen can explain it. In the order of the
 * openers in the form, then list order. Pure: a function of the admin read.
 */
export function eligibleBranchesFor(
  question: EligibilityQuestion,
  tree: AdminBranchTree,
): { branches: AdminBranch[]; leftOutForPrivacy: boolean } {
  const position = positionOf(tree, question);
  const own = question.id !== null && tree.questionById.has(question.id) ? question.id : null;
  const below = own === null ? new Set<string>() : descendantsOf(tree, own);
  let height = 0;
  if (own !== null) {
    for (const sub of tree.branchesByOpener.get(own) ?? []) {
      const measured = branchHeight(tree, sub.id);
      if (measured === null) return { branches: [], leftOutForPrivacy: false };
      height = Math.max(height, measured);
    }
  }
  const found: { branch: AdminBranch; opener: number; list: number }[] = [];
  let leftOutForPrivacy = false;
  tree.branches.forEach((branch, list) => {
    if (branch.archivedAt !== null) return;
    const opener = tree.flatIndex.get(branch.openerQuestionId);
    if (opener === undefined || opener >= position) return;
    if (below.has(branch.openerQuestionId)) return;
    const level = branchLevel(tree, branch.id);
    if (level === null || level + height > MAX_LEVEL) return;
    if (question.showOnProfile && chainHasPrivateOpener(tree, branch.id)) {
      leftOutForPrivacy = true;
      return;
    }
    found.push({ branch, opener, list });
  });
  found.sort((a, b) => a.opener - b.opener || a.list - b.list);
  return { branches: found.map((item) => item.branch), leftOutForPrivacy };
}

/**
 * The ACTIVE questions that may open a branch (UI-D-671), the screen's twin of `checkBranch`: one of the four
 * opener types, before every question of the branch (D-641), not inside the branch's own subtree, with the
 * levels above it plus the branch's own height within three (D-644), and not private when the branch holds a
 * public question (UI-D-675). `null` is a branch about to be created (empty, height 1). In form order.
 */
export function eligibleOpenersFor(
  branch: AdminBranch | null,
  tree: AdminBranchTree,
): AdminQuestion[] {
  const members = branch === null ? [] : membersOf(tree, branch.id);
  const firstMember = Math.min(
    ...members.map((member) => tree.flatIndex.get(member.id) ?? Number.MAX_SAFE_INTEGER),
  );
  const inside = new Set<string>();
  for (const member of members) for (const id of descendantsOf(tree, member.id)) inside.add(id);
  const height = branch === null ? 1 : branchHeight(tree, branch.id);
  if (height === null) return [];
  const hasPublic = [...inside].some((id) => tree.questionById.get(id)?.showOnProfile === true);
  const openerTypes: readonly string[] = PROFILE_FORM_CONDITION_OPENER_TYPES;

  const found: AdminQuestion[] = [];
  for (const id of tree.flatIds) {
    const candidate = tree.questionById.get(id);
    if (candidate === undefined || !openerTypes.includes(candidate.type)) continue;
    if (members.length > 0 && (tree.flatIndex.get(id) ?? 0) >= firstMember) continue;
    if (inside.has(id) || (branch !== null && candidate.branchId === branch.id)) continue;
    let above = 0;
    if (candidate.branchId != null) {
      const level = branchLevel(tree, candidate.branchId);
      if (level === null) continue;
      above = level;
    }
    if (above + height > MAX_LEVEL) continue;
    const isPrivate =
      !candidate.showOnProfile ||
      (candidate.branchId != null && chainHasPrivateOpener(tree, candidate.branchId));
    if (hasPublic && isPrivate) continue;
    found.push(candidate);
  }
  return found;
}

/**
 * The titles of the ACTIVE questions that show on the member profile and have a private opener anywhere on
 * their chain (WR-06, PFORM-53, UI-D-675): what the server would refuse, listed from the read the builder
 * already holds. In list order. Only titles leave.
 */
export function publicUnderPrivateTitles(tree: AdminBranchTree): string[] {
  return tree.questions
    .filter(
      (question) =>
        question.showOnProfile &&
        question.branchId != null &&
        chainHasPrivateOpener(tree, question.branchId),
    )
    .map((question) => question.title);
}

// ── The Fluxo: the form as a tree by branch (D-649, UI-D-676) ─────────────────────────────────────

/** A question node of the Fluxo: what it is and where it sits, never an answer. */
export type FlowQuestion = {
  id: string;
  title: string;
  type: ProfileFormType;
  required: boolean;
  /** True when the question shows on the member profile. */
  showOnProfile: boolean;
  /** The 1-based place of the question's step (the Fluxo draws a pill with two or more steps). */
  stepOrdinal: number;
  branches: FlowBranch[];
};

/** A branch edge of the Fluxo: the label parts (name included, admin lane only) and its questions. */
export type FlowBranch = {
  id: string;
  label: BranchDescription | null;
  /** The ACTIVE questions in the branch; zero for an empty branch or one whose questions are all archived. */
  questionCount: number;
  questions: FlowQuestion[];
};

export type FlowTree = { roots: FlowQuestion[]; stepCount: number };

/**
 * The Fluxo's data (UI-D-676): the root list of the active unconditional questions in form order and, under
 * each opener, its branches in layout order with their questions, to three levels. Archived questions and
 * branches are not in it (a question in an archived branch is drawn as a root). Every active question is
 * drawn once, even in a stored tree with a cycle.
 */
export function flowTree(tree: AdminBranchTree): FlowTree {
  const placed = new Set<string>();

  const draw = (
    question: AdminQuestion,
    depth: number,
    path: ReadonlySet<string>,
  ): FlowQuestion => {
    placed.add(question.id);
    const branches: FlowBranch[] = [];
    if (depth < MAX_LEVEL) {
      for (const branch of orderedBranchesOf(tree, question.id)) {
        if (path.has(branch.id)) continue;
        const all = membersOf(tree, branch.id);
        const members = all
          .filter((member) => !placed.has(member.id))
          .sort((a, b) => (tree.flatIndex.get(a.id) ?? 0) - (tree.flatIndex.get(b.id) ?? 0));
        if (members.length === 0 && all.length > 0) continue;
        const next = new Set([...path, branch.id]);
        branches.push({
          id: branch.id,
          label: describeBranch(branch, tree.questionById),
          questionCount: all.length,
          questions: members.map((member) => draw(member, depth + 1, next)),
        });
      }
    }
    return {
      id: question.id,
      title: question.title,
      type: question.type,
      required: question.required,
      showOnProfile: question.showOnProfile,
      stepOrdinal: tree.stepOrdinal.get(question.stepId) ?? 0,
      branches,
    };
  };

  const roots: FlowQuestion[] = [];
  for (const id of tree.flatIds) {
    const question = tree.questionById.get(id);
    if (question === undefined || usableBranch(tree, question.branchId) !== undefined) continue;
    roots.push(draw(question, 0, new Set()));
  }
  // A question the walk could not reach (a stored cycle) is drawn as a root, never dropped.
  for (const id of tree.flatIds) {
    const question = tree.questionById.get(id);
    if (question !== undefined && !placed.has(id)) roots.push(draw(question, 0, new Set()));
  }
  return { roots, stepCount: tree.steps.length };
}
