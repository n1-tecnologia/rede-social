/**
 * 12.2-01 (D-641, D-644, D-645, PFORM-44, PFORM-54): the pure branch rules of the profile form.
 *
 * RED STUB: the functions below are deliberately inert so the failing tests of this commit fail on an
 * assertion for the planned behavior (a new module cannot be RED from an import error). The GREEN commit
 * replaces every function body; the fixture and the table are the specification and stay as they are.
 */
import { answerTokens } from './profile-form';

void answerTokens;

/** A branch as the rule needs it: only what the database stores. */
export type ProfileFormBranchDef = {
  id: string;
  openerQuestionId: string;
  values: readonly string[];
};

export type BranchTree = {
  branch: (branchId: string) => ProfileFormBranchDef | undefined;
  branchIdOf: (questionId: string) => string | null | undefined;
};

export function branchTreeOf(
  _questions: readonly { id: string; branchId?: string | null }[],
  _branches: readonly ProfileFormBranchDef[],
): BranchTree {
  return { branch: () => undefined, branchIdOf: () => undefined };
}

export function branchChainOf(
  _branchId: string,
  _tree: BranchTree,
): readonly ProfileFormBranchDef[] | null {
  return [];
}

export function isQuestionVisibleInTree(
  _question: { branchId?: string | null },
  _tree: BranchTree,
  _tokensOf: (questionId: string) => readonly string[] | undefined,
): boolean {
  return true;
}

export function visibleStepsInTree(
  steps: readonly { id: string }[],
  _questions: readonly { id: string; stepId: string; branchId?: string | null }[],
  _tree: BranchTree,
  _tokensOf: (questionId: string) => readonly string[] | undefined,
): string[] {
  return steps.map((step) => step.id);
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
