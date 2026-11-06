import {
  PROFILE_FORM_CONDITION_OPENER_TYPES,
  PROFILE_FORM_LIMITS,
  type ProfileFormIssue,
} from '@rede-social/contracts/profile-form';
import { flatten, type Layout } from './layout';

/**
 * The branch rules of the profile form, PURE (Phase 12.2, D-641, D-643, D-644, D-646, D-652, D-653; PFORM-44,
 * PFORM-45, PFORM-48, PFORM-53): what a branch may be, which edits an opener refuses, when a question may
 * enter a branch, what archiving or reactivating a block needs, and the privacy twin of WR-06. No database,
 * no I/O, no clock: the service reads the facts (the tenant's questions, branches, the locked layout and the
 * answer COUNTS) and asks these functions, the `lock-rules.ts` mould. A rule never sees
 * an answer value: only structure, privacy flags and counts.
 *
 * A branch is its own object (an opener question, the opening answers, the questions that name it); a question
 * in a branch is visible only when EVERY branch on its chain is open, and the chain is at most
 * `PROFILE_FORM_LIMITS.branchDepth` long (D-644). The 12.1 per-question condition (one level) is gone from
 * this file, and the 12.1 rule module that judged it was removed in plan 09.
 *
 * Every walk up or down the tree is bounded by `PROFILE_FORM_LIMITS.branchDepth + 1` hops and carries a visited
 * set, so a stored cycle or a depth bomb is a refusal and can never stall the service (D-644, T-12.2-07).
 *
 * `checkBranch` returns the FIRST refusal, in this order (the issue codes are the ones the SQL guard
 * SQLSTATEs map back to in `lock-rules.ts` `GUARD_CODES`, so the race path and the rule path answer the same
 * 409):
 *   0. the branch being edited exists                                   `unknown_branch`
 *   1. the opener is in the list, in the layout and active, and is not a member of the branch itself
 *                                                                        `condition_invalid`
 *   2. its type may open (dropdown, multiple choice, single choice, yes/no; "Outro" opens nothing, D-620)
 *                                                                        `condition_invalid`
 *   3. the values are non-empty, unique and each a token of the opener  `condition_invalid`
 *   4. the opener is not inside the branch's own subtree (no cycle)     `condition_invalid`  (PF010 backstop)
 *   5. the opener sits at a strictly lower flattened index than every question of the branch
 *                                                                        `condition_order`, naming the pair
 *   6. the levels above the opener plus the branch's own height fit the limit
 *                                                                        `branch_depth`       (PF008 backstop)
 *   7. on create, the tenant's active branches are below the limit      `branch_limit`
 *   8. no public question would end up under a private opener           `public_under_private` (PF009 backstop)
 * A stored chain that cannot be walked (an unknown branch or opener, a cycle) refuses at step 6 as
 * `condition_invalid`.
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

/** One refusal, with the entities it names so the route can build the 409 `details`. */
export type BranchCheck =
  | { ok: true }
  | {
      ok: false;
      issue: ProfileFormIssue;
      /** The question the refusal is about (`condition_order`: the member that comes before its opener). */
      questionId?: string;
      /** The opener the refusal is about (`condition_order`, and the archived opener to reactivate first). */
      openerId?: string;
      /** The branch the refusal is about (`branch_archived`: the branch to reactivate first). */
      branchId?: string;
      /** `public_under_private`: the titles of the public questions that would sit under a private opener. */
      titles?: string[];
      /** `has_dependents` of an archive: the openers that hold branches with answers. */
      dependents?: BranchDependent[];
    };

/** The longest walk any rule takes: the limit, plus one hop to tell "at the limit" from "over it". */
const MAX_HOPS = PROFILE_FORM_LIMITS.branchDepth + 1;

const OK: BranchCheck = { ok: true };
type Refusal = Extract<BranchCheck, { ok: false }>;
const refuse = (
  issue: ProfileFormIssue,
  named: Partial<Omit<Refusal, 'ok' | 'issue'>> = {},
): BranchCheck => ({
  ok: false,
  issue,
  ...named,
});
const invalid = (): BranchCheck => refuse('condition_invalid');

const isOpenerType = (type: string) =>
  (PROFILE_FORM_CONDITION_OPENER_TYPES as readonly string[]).includes(type);

type Lookups = {
  question: (id: string) => BranchRuleQuestion | undefined;
  branch: (id: string) => BranchRuleBranch | undefined;
};

function lookupsOf(
  questions: readonly BranchRuleQuestion[],
  branches: readonly BranchRuleBranch[],
): Lookups {
  const byQuestion = new Map(questions.map((question) => [question.id, question]));
  const byBranch = new Map(branches.map((branch) => [branch.id, branch]));
  return {
    question: (id) => byQuestion.get(id),
    branch: (id) => byBranch.get(id),
  };
}

/**
 * The branch, the branches that hang on openers inside it (at any depth, up to the walk bound) and every
 * question of those, in list order. Archived branches and questions are included: the structure does not
 * care, the caller filters. An unknown branch has an empty subtree.
 */
export function subtreeOf(
  branches: readonly BranchRuleBranch[],
  questions: readonly BranchRuleQuestion[],
  branchId: string,
): { branchIds: string[]; questionIds: string[] } {
  if (!branches.some((branch) => branch.id === branchId)) return { branchIds: [], questionIds: [] };
  const questionBranch = new Map(questions.map((question) => [question.id, question.branchId]));
  const seen = new Set<string>([branchId]);
  const branchIds = [branchId];
  let frontier = new Set<string>([branchId]);
  for (let level = 1; level <= MAX_HOPS && frontier.size > 0; level += 1) {
    const next = new Set<string>();
    for (const branch of branches) {
      const holder = questionBranch.get(branch.openerQuestionId) ?? null;
      if (holder === null || !frontier.has(holder) || seen.has(branch.id)) continue;
      seen.add(branch.id);
      branchIds.push(branch.id);
      next.add(branch.id);
    }
    frontier = next;
  }
  return {
    branchIds,
    questionIds: questions
      .filter((question) => question.branchId !== null && seen.has(question.branchId))
      .map((question) => question.id),
  };
}

/**
 * The level of a branch: 1 when its opener sits outside every branch, plus the level of the branch that holds
 * its opener otherwise (B1 is 1, a branch on a question of B1 is 2). `null` for an unknown branch, an unknown
 * opener or a cycle. A chain longer than the limit stops at `branchDepth + 1`, which is enough to say "over".
 */
export function branchLevel(
  branchId: string,
  questions: readonly BranchRuleQuestion[],
  branches: readonly BranchRuleBranch[],
): number | null {
  const tree = lookupsOf(questions, branches);
  const seen = new Set<string>();
  let level = 0;
  let current: string | null = branchId;
  while (current !== null) {
    if (seen.has(current)) return null;
    if (level >= MAX_HOPS) return MAX_HOPS;
    seen.add(current);
    const branch = tree.branch(current);
    const opener = branch === undefined ? undefined : tree.question(branch.openerQuestionId);
    if (opener === undefined) return null;
    level += 1;
    current = opener.branchId;
  }
  return level;
}

/**
 * The height of a branch: the longest run of nested branches below it, counting itself (a branch with none
 * below it is 1). `null` for an unknown branch or a cycle; capped at `branchDepth + 1`, enough to say "over".
 */
export function branchHeight(
  branchId: string,
  questions: readonly BranchRuleQuestion[],
  branches: readonly BranchRuleBranch[],
): number | null {
  if (!branches.some((branch) => branch.id === branchId)) return null;
  const questionBranch = new Map(questions.map((question) => [question.id, question.branchId]));
  const seen = new Set<string>([branchId]);
  let frontier = new Set<string>([branchId]);
  let height = 1;
  while (height < MAX_HOPS) {
    const next = new Set<string>();
    for (const branch of branches) {
      const holder = questionBranch.get(branch.openerQuestionId) ?? null;
      if (holder === null || !frontier.has(holder)) continue;
      if (seen.has(branch.id)) return null;
      seen.add(branch.id);
      next.add(branch.id);
    }
    if (next.size === 0) return height;
    height += 1;
    frontier = next;
  }
  return MAX_HOPS;
}

/** Whether any opener on the chain above `branchId` does not show on the profile. A bounded, loop-safe walk. */
function chainHasPrivateOpener(branchId: string, tree: Lookups): boolean {
  const seen = new Set<string>();
  let current: string | null = branchId;
  for (let hops = 0; current !== null && hops < MAX_HOPS; hops += 1) {
    if (seen.has(current)) return false;
    seen.add(current);
    const branch = tree.branch(current);
    const opener = branch === undefined ? undefined : tree.question(branch.openerQuestionId);
    if (opener === undefined) return false;
    if (!opener.showOnProfile) return true;
    current = opener.branchId;
  }
  return false;
}

/** The active questions that show on the profile and have a private opener somewhere on their chain. */
function offendersOf(
  questions: readonly BranchRuleQuestion[],
  branches: readonly BranchRuleBranch[],
): BranchRuleQuestion[] {
  const tree = lookupsOf(questions, branches);
  return questions.filter(
    (question) =>
      !question.archived &&
      question.showOnProfile &&
      question.branchId !== null &&
      chainHasPrivateOpener(question.branchId, tree),
  );
}

/**
 * PFORM-53, WR-06 (T-12.2-02), the pure twin of the PF009 trigger: the titles of the ACTIVE questions that
 * show on the profile and have, anywhere on their chain, an opener that does not, in list order. Their mere
 * presence would reveal what the member answered to the private opener. Reads `showOnProfile` and the chain,
 * never an answer.
 */
export function publicUnderPrivate(
  questions: readonly BranchRuleQuestion[],
  branches: readonly BranchRuleBranch[],
): string[] {
  return offendersOf(questions, branches).map((question) => question.title);
}

/**
 * The offenders a candidate tree adds over the stored one: a violation that is already stored (legacy data)
 * must not make an unrelated edit fail. Compared by question id, titles returned in list order.
 */
export function newPublicUnderPrivate(
  questions: readonly BranchRuleQuestion[],
  branches: readonly BranchRuleBranch[],
  candidateQuestions: readonly BranchRuleQuestion[],
  candidateBranches: readonly BranchRuleBranch[],
): string[] {
  const stored = new Set(offendersOf(questions, branches).map((question) => question.id));
  return offendersOf(candidateQuestions, candidateBranches)
    .filter((question) => !stored.has(question.id))
    .map((question) => question.title);
}

/**
 * One `{ questionId, openerId }` fact per ACTIVE question that sits in an ACTIVE branch, in list order: the
 * input of `checkLayoutOrder` (D-652). Transitivity covers nested chains, so one fact per question suffices.
 */
export function branchFactsOf(
  questions: readonly BranchRuleQuestion[],
  branches: readonly BranchRuleBranch[],
): { questionId: string; openerId: string }[] {
  const tree = lookupsOf(questions, branches);
  const facts: { questionId: string; openerId: string }[] = [];
  for (const question of questions) {
    if (question.archived || question.branchId === null) continue;
    const branch = tree.branch(question.branchId);
    if (branch === undefined || branch.archived) continue;
    facts.push({ questionId: question.id, openerId: branch.openerQuestionId });
  }
  return facts;
}

/** The tokens a question of this type can contribute: option ids, or `true`/`false` for a yes/no. */
const tokensOf = (opener: BranchRuleQuestion): ReadonlySet<string> =>
  opener.type === 'yes_no'
    ? new Set(['true', 'false'])
    : new Set(opener.options.map((option) => option.id));

/** The id the candidate branch of a create carries inside the privacy walk; never stored. */
const CANDIDATE_BRANCH_ID = '\u0000candidate';

/**
 * Whether a branch with this opener and these values may exist (create) or replace the stored one (edit).
 * `branchId` names the branch being edited; `creating` is set for a new branch (the tenant limit applies). A
 * new branch is empty, so the order, cycle and privacy steps are about the branch's members only when it
 * already has some. The first refusal wins, in the order of the header.
 */
export function checkBranch(input: {
  questions: readonly BranchRuleQuestion[];
  branches: readonly BranchRuleBranch[];
  layout: Layout;
  openerId: string;
  values: readonly string[];
  branchId?: string;
  creating?: boolean;
}): BranchCheck {
  const { questions, branches, layout, openerId, values, branchId } = input;
  const creating = input.creating === true;

  if (branchId !== undefined && !branches.some((branch) => branch.id === branchId))
    return refuse('unknown_branch');

  const opener = questions.find((question) => question.id === openerId);
  if (opener === undefined || opener.archived) return invalid();
  const flat = flatten(layout);
  const openerIndex = flat.indexOf(opener.id);
  if (openerIndex === -1) return invalid();
  if (branchId !== undefined && opener.branchId === branchId) return invalid();

  if (!isOpenerType(opener.type)) return invalid();

  if (values.length === 0 || new Set(values).size !== values.length) return invalid();
  const allowed = tokensOf(opener);
  if (!values.every((token) => allowed.has(token))) return invalid();

  if (branchId !== undefined) {
    const inside = subtreeOf(branches, questions, branchId).questionIds;
    if (inside.includes(opener.id)) return invalid();

    const members = questions
      .filter((question) => question.branchId === branchId && !question.archived)
      .map((question) => ({ id: question.id, at: flat.indexOf(question.id) }))
      .filter((member) => member.at !== -1)
      .sort((a, b) => a.at - b.at);
    const first = members.find((member) => member.at <= openerIndex);
    if (first !== undefined)
      return refuse('condition_order', { questionId: first.id, openerId: opener.id });
  }

  const above = opener.branchId === null ? 0 : branchLevel(opener.branchId, questions, branches);
  const own = branchId === undefined ? 1 : branchHeight(branchId, questions, branches);
  if (above === null || own === null) return invalid();
  if (above + own > PROFILE_FORM_LIMITS.branchDepth) return refuse('branch_depth');

  if (
    creating &&
    branches.filter((branch) => !branch.archived).length >= PROFILE_FORM_LIMITS.branches
  )
    return refuse('branch_limit');

  const candidate: BranchRuleBranch[] =
    branchId === undefined
      ? [
          ...branches,
          {
            id: CANDIDATE_BRANCH_ID,
            openerQuestionId: openerId,
            values,
            archived: false,
            name: null,
          },
        ]
      : branches.map((branch) =>
          branch.id === branchId ? { ...branch, openerQuestionId: openerId, values } : branch,
        );
  const titles = newPublicUnderPrivate(questions, branches, questions, candidate);
  if (titles.length > 0) return refuse('public_under_private', { titles });

  return OK;
}

// ── Locks, dependents, moves, archive and reactivation (D-646, D-653; PFORM-48, PFORM-53) ────────────────────

/** An active branch hanging on an opener, with the titles of its active questions. */
export type BranchDependents = {
  id: string;
  name: string | null;
  openerQuestionId: string;
  values: string[];
  questions: BranchDependent[];
};

const sameSet = (a: Iterable<string>, b: Iterable<string>): boolean => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((token) => right.has(token));
};

/**
 * D-646: a branch with an answered question (active OR archived; `answeredQuestions` is a COUNT, never a
 * value) cannot change its opener or its opening set (compared as sets). A name change, an unchanged opener
 * or set, and an undo (which the service does not route through here) pass at any answer count. An omitted
 * `openerId` or `values` means "not changed". The SQL backstop is the branch guard (PF006).
 */
export function checkBranchEdit(input: {
  branch: BranchRuleBranch;
  openerId?: string;
  values?: readonly string[];
  answeredQuestions: number;
}): BranchCheck {
  const { branch, openerId, values, answeredQuestions } = input;
  if (answeredQuestions <= 0) return OK;
  if (openerId !== undefined && openerId !== branch.openerQuestionId)
    return refuse('condition_locked');
  if (values !== undefined && !sameSet(values, branch.values)) return refuse('condition_locked');
  return OK;
}

/**
 * The ACTIVE branches that hang on `openerId`, in list order, each with the titles of its ACTIVE questions
 * (an empty branch is listed with none). The input of every `has_dependents` body (D-646).
 */
export function dependentBranchesOf(
  branches: readonly BranchRuleBranch[],
  questions: readonly BranchRuleQuestion[],
  openerId: string,
): BranchDependents[] {
  return branches
    .filter((branch) => !branch.archived && branch.openerQuestionId === openerId)
    .map((branch) => ({
      id: branch.id,
      name: branch.name,
      openerQuestionId: branch.openerQuestionId,
      values: [...branch.values],
      questions: questions
        .filter((question) => !question.archived && question.branchId === branch.id)
        .map((question) => ({ id: question.id, title: question.title })),
    }));
}

/**
 * D-646: the refusals of an opener. Archiving it (a delete is an archive that has no active dependents left),
 * changing its type, or removing an option id that some active branch names (even an option with no answer)
 * is `has_dependents` with the active branches the change would orphan; for removed options only the
 * branches that name a removed id are listed. With no active branch, or when only unreferenced options go,
 * the answer is null. The SQL backstop is the question guard (PF007).
 */
export function checkOpenerChange(input: {
  questions: readonly BranchRuleQuestion[];
  branches: readonly BranchRuleBranch[];
  openerId: string;
  archive?: boolean;
  newType?: string;
  removedOptionIds?: readonly string[];
}): { issue: 'has_dependents'; branches: BranchDependents[] } | null {
  const { questions, branches, openerId, archive, newType, removedOptionIds } = input;
  const dependents = dependentBranchesOf(branches, questions, openerId);
  if (dependents.length === 0) return null;

  const opener = questions.find((question) => question.id === openerId);
  const retyped = newType !== undefined && opener !== undefined && newType !== opener.type;
  const removed = new Set(removedOptionIds ?? []);
  const affected =
    archive || retyped
      ? dependents
      : dependents.filter((dependent) => dependent.values.some((token) => removed.has(token)));
  if (affected.length === 0) return null;
  return { issue: 'has_dependents', branches: affected };
}

/** Whether `questionId` is the opener of some branch on the chain above (and including) `branchId`. */
function opensChainOf(
  questionId: string,
  branchId: string,
  tree: Lookups,
): 'yes' | 'no' | 'broken' {
  const seen = new Set<string>();
  let current: string | null = branchId;
  for (let hops = 0; current !== null && hops < MAX_HOPS; hops += 1) {
    if (seen.has(current)) return 'broken';
    seen.add(current);
    const branch = tree.branch(current);
    const opener = branch === undefined ? undefined : tree.question(branch.openerQuestionId);
    if (branch === undefined || opener === undefined) return 'broken';
    if (branch.openerQuestionId === questionId) return 'yes';
    current = opener.branchId;
  }
  return 'no';
}

/**
 * D-646, D-641, D-643, D-644: whether a question may enter, leave or change branch. `branchId` is the target
 * (null removes the branch). A question being CREATED is passed in `questions` with `branchId: null` and left
 * out of the layout, which counts as sitting after everything. `answered` is the question's answer COUNT. The
 * first refusal wins: an unchanged branch passes; answers (`condition_locked`, entering, leaving or changing);
 * a removal passes; an unknown branch (`unknown_branch`); an archived one (`branch_archived`, naming it); the
 * question is the opener of a branch on the target's chain, so the target is its own descendant, or the chain
 * cannot be walked (`condition_invalid`); the target's opener is not strictly before the question
 * (`condition_order` naming the pair); the target's level plus the height of the question's own sub-branches
 * is over the limit (`branch_depth`); a public question (or a public descendant of a moved opener) ends up
 * under a private opener (`public_under_private`, naming the titles it ADDS).
 */
export function checkMoveIntoBranch(input: {
  questions: readonly BranchRuleQuestion[];
  branches: readonly BranchRuleBranch[];
  layout: Layout;
  questionId: string;
  branchId: string | null;
  answered: number;
}): BranchCheck {
  const { questions, branches, layout, questionId, branchId, answered } = input;
  const question = questions.find((candidate) => candidate.id === questionId);
  if (question === undefined) return refuse('unknown_question');
  if (branchId === question.branchId) return OK;
  if (answered > 0) return refuse('condition_locked');
  if (branchId === null) return OK;

  const target = branches.find((branch) => branch.id === branchId);
  if (target === undefined) return refuse('unknown_branch');
  if (target.archived) return refuse('branch_archived', { branchId: target.id });

  if (opensChainOf(questionId, target.id, lookupsOf(questions, branches)) !== 'no')
    return invalid();

  const flat = flatten(layout);
  const openerIndex = flat.indexOf(target.openerQuestionId);
  if (openerIndex === -1) return invalid();
  const questionIndex = flat.indexOf(questionId);
  if (questionIndex !== -1 && openerIndex >= questionIndex)
    return refuse('condition_order', { questionId, openerId: target.openerQuestionId });

  const level = branchLevel(target.id, questions, branches);
  if (level === null) return invalid();
  let below = 0;
  for (const own of branches.filter((branch) => branch.openerQuestionId === questionId)) {
    const height = branchHeight(own.id, questions, branches);
    if (height === null) return invalid();
    below = Math.max(below, height);
  }
  if (level + below > PROFILE_FORM_LIMITS.branchDepth) return refuse('branch_depth');

  const moved = questions.map((candidate) =>
    candidate.id === questionId ? { ...candidate, branchId } : candidate,
  );
  const titles = newPublicUnderPrivate(questions, branches, moved, branches);
  if (titles.length > 0) return refuse('public_under_private', { titles });

  return OK;
}

/**
 * D-653: whether an archived question may become active again. A question with no branch always passes; an
 * unknown question is `unknown_question`; a dangling branch is `unknown_branch`. Otherwise the ONE thing to
 * do first is named: the question's branch is archived (`branch_archived` with `branchId`), the opener is
 * archived or gone (`condition_invalid` with `openerId`), or the opener sits in an archived branch
 * (`branch_archived` with that branch). Then the order (when the question is in the layout) and the privacy
 * rule (`public_under_private`) run over the tree with the question active.
 */
export function checkReactivation(input: {
  questions: readonly BranchRuleQuestion[];
  branches: readonly BranchRuleBranch[];
  layout: Layout;
  questionId: string;
}): BranchCheck {
  const { questions, branches, layout, questionId } = input;
  const question = questions.find((candidate) => candidate.id === questionId);
  if (question === undefined) return refuse('unknown_question');
  if (question.branchId === null) return OK;

  const tree = lookupsOf(questions, branches);
  const branch = tree.branch(question.branchId);
  if (branch === undefined) return refuse('unknown_branch');
  if (branch.archived) return refuse('branch_archived', { branchId: branch.id });
  const opener = tree.question(branch.openerQuestionId);
  if (opener === undefined || opener.archived)
    return refuse('condition_invalid', { openerId: branch.openerQuestionId });
  const above = opener.branchId === null ? undefined : tree.branch(opener.branchId);
  if (above?.archived) return refuse('branch_archived', { branchId: above.id });

  const flat = flatten(layout);
  const questionIndex = flat.indexOf(questionId);
  const openerIndex = flat.indexOf(opener.id);
  if (questionIndex !== -1 && (openerIndex === -1 || openerIndex >= questionIndex))
    return refuse('condition_order', { questionId, openerId: opener.id });

  const active = questions.map((candidate) =>
    candidate.id === questionId ? { ...candidate, archived: false } : candidate,
  );
  const titles = newPublicUnderPrivate(questions, branches, active, branches);
  if (titles.length > 0) return refuse('public_under_private', { titles });

  return OK;
}

/**
 * D-653: whether a branch may be archived (the block goes out together: the branch, the branches below it and
 * their questions; the answers stay). An unknown branch is `unknown_branch`, an archived one
 * `already_archived`. It is refused as `has_dependents`, with `dependents` naming the OPENERS, when a question
 * of the subtree opens another ACTIVE branch that has answers (`answeredBranchIds`: ids of branches with an
 * answered question, a COUNT-style fact). The branch's own answers do not block. The services stamp one
 * `now()` over the whole subtree, branches first and then questions (Pitfall 4): that is not a rule here.
 */
export function checkArchiveBranch(input: {
  questions: readonly BranchRuleQuestion[];
  branches: readonly BranchRuleBranch[];
  branchId: string;
  answeredBranchIds: ReadonlySet<string> | readonly string[];
}): BranchCheck {
  const { questions, branches, branchId } = input;
  const branch = branches.find((candidate) => candidate.id === branchId);
  if (branch === undefined) return refuse('unknown_branch');
  if (branch.archived) return refuse('already_archived');

  const answered = new Set(input.answeredBranchIds);
  const tree = lookupsOf(questions, branches);
  const dependents: BranchDependent[] = [];
  for (const nestedId of subtreeOf(branches, questions, branchId).branchIds) {
    const nested = tree.branch(nestedId);
    if (nestedId === branchId || nested === undefined || nested.archived || !answered.has(nestedId))
      continue;
    const opener = tree.question(nested.openerQuestionId);
    if (opener === undefined || dependents.some((dependent) => dependent.id === opener.id))
      continue;
    dependents.push({ id: opener.id, title: opener.title });
  }
  if (dependents.length > 0) return refuse('has_dependents', { dependents });
  return OK;
}

/**
 * D-653: whether an archived branch may come back (with the branches below it and their questions). An
 * unknown branch is `unknown_branch`, one that is not archived `not_archived`; an opener that is archived or
 * gone is `condition_invalid` with `openerId` (the ONE thing to reactivate first), an opener inside an
 * archived branch is `branch_archived` with that branch. The privacy rule then runs over the tree with the
 * restored questions active: `restoredQuestionIds` names exactly the ones the service will restore (the
 * cascade stamp is the service's knowledge); omitted, every question of the subtree counts, the safe side.
 */
export function checkReactivateBranch(input: {
  questions: readonly BranchRuleQuestion[];
  branches: readonly BranchRuleBranch[];
  branchId: string;
  restoredQuestionIds?: readonly string[];
}): BranchCheck {
  const { questions, branches, branchId } = input;
  const branch = branches.find((candidate) => candidate.id === branchId);
  if (branch === undefined) return refuse('unknown_branch');
  if (!branch.archived) return refuse('not_archived');

  const tree = lookupsOf(questions, branches);
  const opener = tree.question(branch.openerQuestionId);
  if (opener === undefined || opener.archived)
    return refuse('condition_invalid', { openerId: branch.openerQuestionId });
  const above = opener.branchId === null ? undefined : tree.branch(opener.branchId);
  if (above?.archived) return refuse('branch_archived', { branchId: above.id });

  const subtree = subtreeOf(branches, questions, branchId);
  const restored = new Set(input.restoredQuestionIds ?? subtree.questionIds);
  const awake = new Set(subtree.branchIds);
  const candidateQuestions = questions.map((question) =>
    restored.has(question.id) ? { ...question, archived: false } : question,
  );
  const candidateBranches = branches.map((candidate) =>
    awake.has(candidate.id) ? { ...candidate, archived: false } : candidate,
  );
  const titles = newPublicUnderPrivate(questions, branches, candidateQuestions, candidateBranches);
  if (titles.length > 0) return refuse('public_under_private', { titles });

  return OK;
}
