/**
 * 12.2-01 (D-641, D-644, D-645, PFORM-44, PFORM-54): the pure branch rules of the profile form.
 *
 * A branch is its own object: an opener question, the opening answers (any one opens it) and the questions
 * that name it. A question in a branch is visible only when EVERY branch on its chain is open, the chain is
 * at most `PROFILE_FORM_LIMITS.branchDepth` long, and a malformed tree (an unknown branch or opener, a
 * cycle, a chain deeper than the limit) hides the question: the safe direction for a member (a hidden
 * question is never owed) and for a reader (a hidden answer is never shown). No function here recurses.
 *
 * TypeScript twin of the SQL gate and purge of plans 06 and 07; both are asserted against
 * `PROFILE_FORM_CHAIN_CASES`, so a new shape adds a row to that table in the same change.
 */
import { PROFILE_FORM_LIMITS } from './profile-form';

/** A branch as the rule needs it: only what the database stores. */
export type ProfileFormBranchDef = {
  id: string;
  openerQuestionId: string;
  /** Option ids, or `'true'` / `'false'`; ANY one of them opens the branch. Exact, case-sensitive strings. */
  values: readonly string[];
};

/** The two lookups the rule walks. `branchIdOf` answers `undefined` for a question it does not know. */
export type BranchTree = {
  branch: (branchId: string) => ProfileFormBranchDef | undefined;
  branchIdOf: (questionId: string) => string | null | undefined;
};

/** Builds both lookups from plain arrays (the readers hold arrays, never maps). */
export function branchTreeOf(
  questions: readonly { id: string; branchId?: string | null }[],
  branches: readonly ProfileFormBranchDef[],
): BranchTree {
  const byBranch = new Map(branches.map((branch) => [branch.id, branch]));
  const byQuestion = new Map(questions.map((question) => [question.id, question.branchId ?? null]));
  return {
    branch: (branchId) => byBranch.get(branchId),
    branchIdOf: (questionId) => byQuestion.get(questionId),
  };
}

/**
 * The branches above a branch, nearest first and the branch itself first of all: `[B3, B2, B1]` for a branch
 * three levels deep. `null` for an unknown branch, an unknown opener, a cycle or a chain longer than
 * `PROFILE_FORM_LIMITS.branchDepth`. A bounded walk of at most `branchDepth` hops.
 */
export function branchChainOf(
  branchId: string,
  tree: BranchTree,
): readonly ProfileFormBranchDef[] | null {
  const chain: ProfileFormBranchDef[] = [];
  let current: string | null = branchId;
  for (let hops = 0; current !== null; hops += 1) {
    if (hops >= PROFILE_FORM_LIMITS.branchDepth) return null;
    const branch = tree.branch(current);
    if (branch === undefined) return null;
    chain.push(branch);
    const next = tree.branchIdOf(branch.openerQuestionId);
    if (next === undefined) return null;
    current = next;
  }
  return chain;
}

/**
 * Whether a question is shown (D-641, D-644): no branch is always visible; with one, every branch on its
 * chain must be open, that is the opener's tokens share at least one value with the branch's values. A
 * stale answer deeper in the chain therefore never keeps a question visible once a branch above it closed.
 * `tokensOf` answers `undefined` for an opener it knows nothing about, which hides the question.
 */
export function isQuestionVisibleInTree(
  question: { branchId?: string | null },
  tree: BranchTree,
  tokensOf: (questionId: string) => readonly string[] | undefined,
): boolean {
  const branchId = question.branchId ?? null;
  if (branchId === null) return true;
  const chain = branchChainOf(branchId, tree);
  if (chain === null) return false;
  return chain.every((branch) => {
    const tokens = tokensOf(branch.openerQuestionId);
    return tokens !== undefined && branch.values.some((value) => tokens.includes(value));
  });
}

/**
 * The ids of the steps that hold at least one visible question, in the given step order. A step whose
 * questions are all hidden, and a step with no question, are absent (the 12.1 `visibleSteps` shape with
 * `branchId` in place of `condition`).
 */
export function visibleStepsInTree(
  steps: readonly { id: string }[],
  questions: readonly { id: string; stepId: string; branchId?: string | null }[],
  tree: BranchTree,
  tokensOf: (questionId: string) => readonly string[] | undefined,
): string[] {
  const withVisible = new Set(
    questions
      .filter((question) => isQuestionVisibleInTree(question, tree, tokensOf))
      .map((question) => question.stepId),
  );
  return steps.filter((step) => withVisible.has(step.id)).map((step) => step.id);
}

// ── The parity table fixture (D-645): the team's own clinic wording, never the client's list ───────

export type ChainFixture = {
  questions: readonly {
    key: string;
    id: string;
    type: 'single_choice' | 'multiple_choice' | 'yes_no' | 'short_text' | 'number';
    required: boolean;
    branchId: string | null;
  }[];
  branches: readonly { key: string; id: string; openerKey: string; values: readonly string[] }[];
};

const TEM = '24000000-0000-4000-8000-0000000000e1';
const TRABALHA = '24000000-0000-4000-8000-0000000000e2';
const APRENDE = '24000000-0000-4000-8000-0000000000e3';
const B1 = '24000000-0000-4000-8000-0000000000b1';
const B2 = '24000000-0000-4000-8000-0000000000b2';
const B3 = '24000000-0000-4000-8000-0000000000b3';
const B4 = '24000000-0000-4000-8000-0000000000b4';

/**
 * Q1 "Você tem clínica, trabalha em clínica ou está aprendendo?" (tem, trabalha, aprende). B1 opens on
 * Q1=tem (Q2 "A clínica tem equipe?", required Q3 "Nome da clínica"); B2 opens on Q2=true (required Q4
 * "Quantos profissionais?", Q5 "Tem sócio?"); B3 opens on Q5=true (required Q6 "Nome do sócio", depth 3);
 * B4 opens on Q1=aprende (required Q7 "Onde estuda?").
 */
export const PROFILE_FORM_CHAIN_FIXTURE: ChainFixture = {
  questions: [
    {
      key: 'Q1',
      id: '24000000-0000-4000-8000-000000000001',
      type: 'single_choice',
      required: false,
      branchId: null,
    },
    {
      key: 'Q2',
      id: '24000000-0000-4000-8000-000000000002',
      type: 'yes_no',
      required: false,
      branchId: B1,
    },
    {
      key: 'Q3',
      id: '24000000-0000-4000-8000-000000000003',
      type: 'short_text',
      required: true,
      branchId: B1,
    },
    {
      key: 'Q4',
      id: '24000000-0000-4000-8000-000000000004',
      type: 'number',
      required: true,
      branchId: B2,
    },
    {
      key: 'Q5',
      id: '24000000-0000-4000-8000-000000000005',
      type: 'yes_no',
      required: false,
      branchId: B2,
    },
    {
      key: 'Q6',
      id: '24000000-0000-4000-8000-000000000006',
      type: 'short_text',
      required: true,
      branchId: B3,
    },
    {
      key: 'Q7',
      id: '24000000-0000-4000-8000-000000000007',
      type: 'short_text',
      required: true,
      branchId: B4,
    },
  ],
  branches: [
    { key: 'B1', id: B1, openerKey: 'Q1', values: [TEM] },
    { key: 'B2', id: B2, openerKey: 'Q2', values: ['true'] },
    { key: 'B3', id: B3, openerKey: 'Q5', values: ['true'] },
    { key: 'B4', id: B4, openerKey: 'Q1', values: [APRENDE] },
  ],
};

/**
 * Row 10: an any-of multiple-choice opener at depth 2. Q1 (single choice) opens B1 on tem; B1 holds Q2
 * (multiple choice, three options); B2 opens on Q2 having the second OR the third option and holds the
 * required Q3.
 */
export const PROFILE_FORM_CHAIN_FIXTURE_ANY_OF: ChainFixture = {
  questions: [
    {
      key: 'Q1',
      id: '24000000-0000-4000-8000-0000000000a1',
      type: 'single_choice',
      required: false,
      branchId: null,
    },
    {
      key: 'Q2',
      id: '24000000-0000-4000-8000-0000000000a2',
      type: 'multiple_choice',
      required: false,
      branchId: '24000000-0000-4000-8000-0000000000a5',
    },
    {
      key: 'Q3',
      id: '24000000-0000-4000-8000-0000000000a3',
      type: 'short_text',
      required: true,
      branchId: '24000000-0000-4000-8000-0000000000a6',
    },
  ],
  branches: [
    {
      key: 'B1',
      id: '24000000-0000-4000-8000-0000000000a5',
      openerKey: 'Q1',
      values: [TEM],
    },
    {
      key: 'B2',
      id: '24000000-0000-4000-8000-0000000000a6',
      openerKey: 'Q2',
      values: ['24000000-0000-4000-8000-0000000000f2', '24000000-0000-4000-8000-0000000000f3'],
    },
  ],
};

/**
 * Row 11: a broken tree. Q2..Q4 sit on a legal chain of three (B1, B2, B3); Q5 sits in B4, a fourth level
 * (deeper than the limit); Q6 names a branch that does not exist.
 */
export const PROFILE_FORM_CHAIN_FIXTURE_BROKEN: ChainFixture = {
  questions: [
    {
      key: 'Q1',
      id: '24000000-0000-4000-8000-0000000000c1',
      type: 'single_choice',
      required: false,
      branchId: null,
    },
    {
      key: 'Q2',
      id: '24000000-0000-4000-8000-0000000000c2',
      type: 'yes_no',
      required: false,
      branchId: '24000000-0000-4000-8000-0000000000d1',
    },
    {
      key: 'Q3',
      id: '24000000-0000-4000-8000-0000000000c3',
      type: 'yes_no',
      required: false,
      branchId: '24000000-0000-4000-8000-0000000000d2',
    },
    {
      key: 'Q4',
      id: '24000000-0000-4000-8000-0000000000c4',
      type: 'yes_no',
      required: false,
      branchId: '24000000-0000-4000-8000-0000000000d3',
    },
    {
      key: 'Q5',
      id: '24000000-0000-4000-8000-0000000000c5',
      type: 'short_text',
      required: true,
      branchId: '24000000-0000-4000-8000-0000000000d4',
    },
    {
      key: 'Q6',
      id: '24000000-0000-4000-8000-0000000000c6',
      type: 'short_text',
      required: true,
      branchId: '24000000-0000-4000-8000-0000000000dd',
    },
  ],
  branches: [
    {
      key: 'B1',
      id: '24000000-0000-4000-8000-0000000000d1',
      openerKey: 'Q1',
      values: [TEM],
    },
    {
      key: 'B2',
      id: '24000000-0000-4000-8000-0000000000d2',
      openerKey: 'Q2',
      values: ['true'],
    },
    {
      key: 'B3',
      id: '24000000-0000-4000-8000-0000000000d3',
      openerKey: 'Q3',
      values: ['true'],
    },
    {
      key: 'B4',
      id: '24000000-0000-4000-8000-0000000000d4',
      openerKey: 'Q4',
      values: ['true'],
    },
  ],
};

export type ChainCase = {
  name: string;
  /** Stored answers by question KEY, in the STORED value shape (what `answerTokens` reads). */
  stored: Record<string, unknown>;
  /** The question keys a member sees, the keys the gate owes (required, visible, unanswered) and the keys the purge deletes (answered, not visible). */
  visible: readonly string[];
  owed: readonly string[];
  purged: readonly string[];
  /** The tree of a row that the clinic fixture cannot hold; absent means `PROFILE_FORM_CHAIN_FIXTURE`. */
  fixture?: ChainFixture;
  /** Rows 10 and 11 are checked by TypeScript only: SQL cannot hold an any-of fixture of its own or a fourth level (PF008). */
  tsOnly?: true;
};

const pick = (optionId: string) => ({ optionId, otherText: null });

export const PROFILE_FORM_CHAIN_CASES: readonly ChainCase[] = [
  {
    name: 'row 1: no answers, only the top question is visible',
    stored: {},
    visible: ['Q1'],
    owed: [],
    purged: [],
  },
  {
    name: 'row 2: depth 1, Q1=tem opens B1',
    stored: { Q1: pick(TEM) },
    visible: ['Q1', 'Q2', 'Q3'],
    owed: ['Q3'],
    purged: [],
  },
  {
    name: 'row 3: depth 2, Q2=true opens B2',
    stored: { Q1: pick(TEM), Q2: true },
    visible: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'],
    owed: ['Q3', 'Q4'],
    purged: [],
  },
  {
    name: 'row 4: depth 3, Q5=true opens B3',
    stored: { Q1: pick(TEM), Q2: true, Q5: true },
    visible: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'],
    owed: ['Q3', 'Q4', 'Q6'],
    purged: [],
  },
  {
    name: 'row 5: stale deeper answers, Q1 changed to trabalha closes the whole chain',
    stored: { Q1: pick(TRABALHA), Q2: true, Q5: true },
    visible: ['Q1'],
    owed: [],
    purged: ['Q2', 'Q5'],
  },
  {
    name: 'row 6: stale middle answer, Q2=false closes B2 and B3 while B1 stays open',
    stored: { Q1: pick(TEM), Q2: false, Q5: true },
    visible: ['Q1', 'Q2', 'Q3'],
    owed: ['Q3'],
    purged: ['Q5'],
  },
  {
    name: 'row 7: the other branch of the same opener, Q1=aprende opens B4',
    stored: { Q1: pick(APRENDE) },
    visible: ['Q1', 'Q7'],
    owed: ['Q7'],
    purged: [],
  },
  {
    name: 'row 8: Outro on the opener (no option id) opens nothing',
    stored: { Q1: { optionId: null, otherText: 'x' } },
    visible: ['Q1'],
    owed: [],
    purged: [],
  },
  {
    name: "row 9: a yes/no answer stored as the string 'true' is no token",
    stored: { Q1: pick(TEM), Q2: 'true' },
    visible: ['Q1', 'Q2', 'Q3'],
    owed: ['Q3'],
    purged: [],
  },
  {
    name: 'row 10: any-of multiple-choice opener at depth 2, one overlapping option opens',
    fixture: PROFILE_FORM_CHAIN_FIXTURE_ANY_OF,
    tsOnly: true,
    stored: {
      Q1: pick(TEM),
      Q2: {
        optionIds: ['24000000-0000-4000-8000-0000000000f1', '24000000-0000-4000-8000-0000000000f3'],
        otherText: null,
      },
    },
    visible: ['Q1', 'Q2', 'Q3'],
    owed: ['Q3'],
    purged: [],
  },
  {
    name: 'row 11: broken tree, a fourth level and an unknown branch are hidden',
    fixture: PROFILE_FORM_CHAIN_FIXTURE_BROKEN,
    tsOnly: true,
    stored: { Q1: pick(TEM), Q2: true, Q3: true, Q4: true, Q5: 'x', Q6: 'y' },
    visible: ['Q1', 'Q2', 'Q3', 'Q4'],
    owed: [],
    purged: ['Q5', 'Q6'],
  },
];
