import type {
  AdminBranch,
  AdminQuestion,
  AdminQuestionList,
  AdminStep,
  ArchivedQuestion,
  MemberBranch,
  MemberForm,
  MemberQuestion,
  ProfileFormType,
} from '@rede-social/contracts/profile-form';
import { PROFILE_FORM_CHAIN_FIXTURE } from '@rede-social/contracts/profile-form-branches';

/**
 * Builders for the profile form's component and state tests (12-12). A question is what
 * `GET /v1/me/profile-form` returns; ids are stable UUID-shaped strings so a test can name them.
 */

let counter = 0;

export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/** The step every member `question` sits in unless a test names another (12.1-11, D-628). */
export const MEMBER_STEP_ID = uuid(700);

export function question(
  type: ProfileFormType,
  overrides: Partial<MemberQuestion> = {},
): MemberQuestion {
  counter += 1;
  return {
    id: uuid(counter),
    type,
    title: `Pergunta ${counter}`,
    helpText: null,
    required: false,
    showOnProfile: false,
    allowOther: false,
    limits: {},
    stepId: MEMBER_STEP_ID,
    condition: null,
    options: [],
    answer: null,
    ...overrides,
  };
}

export function options(...labels: string[]): { id: string; label: string }[] {
  return labels.map((label, index) => ({ id: uuid(9000 + index), label }));
}

export function form(questions: MemberQuestion[], overrides: Partial<MemberForm> = {}): MemberForm {
  return {
    mode: 'first',
    missingRequired: questions.filter((q) => q.required && q.answer === null).length,
    formEtag: 'etag-1',
    steps: [{ id: MEMBER_STEP_ID, title: 'Etapa 1' }],
    questions,
    ...overrides,
  };
}

/**
 * Builders for the BUILDER's tests (12-15): a row of `GET /v1/profile_form/questions` and of
 * `GET /v1/profile_form/archived`. Counts only, never an answer (PFORM-23).
 */
let adminCounter = 0;

/** The step every `adminQuestion` sits in unless a test names another (12.1-08, D-627). */
export const ADMIN_STEP_ID = uuid(800);

let adminStepCounter = 0;

/** A step of `GET /v1/profile_form/questions` (12.1-08): its place, revision and active question count. */
export function adminStep(overrides: Partial<AdminStep> = {}): AdminStep {
  adminStepCounter += 1;
  return {
    id: uuid(799 + adminStepCounter),
    title: `Etapa ${adminStepCounter}`,
    position: adminStepCounter,
    revision: 1,
    questionCount: 0,
    ...overrides,
  };
}

/** A whole `GET /v1/profile_form/questions` answer (12.1-08) for the tests that build the list at once. */
export function adminQuestionList(
  questions: AdminQuestion[],
  overrides: Partial<AdminQuestionList> = {},
): AdminQuestionList {
  return {
    questions,
    activeCount: questions.length,
    limit: 30,
    steps: [],
    stepLimit: 10,
    ...overrides,
  };
}

export function adminQuestion(
  type: ProfileFormType,
  overrides: Partial<AdminQuestion> = {},
): AdminQuestion {
  adminCounter += 1;
  return {
    id: uuid(500 + adminCounter),
    stepId: ADMIN_STEP_ID,
    type,
    title: `Pergunta do admin ${adminCounter}`,
    helpText: null,
    required: false,
    showOnProfile: false,
    allowOther: false,
    limits: {},
    options: [],
    position: adminCounter,
    revision: 1,
    answerCount: 0,
    condition: null,
    opensCount: 0,
    createdAt: '2026-10-01T12:00:00.000Z',
    listedAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  };
}

export function archivedQuestion(
  type: ProfileFormType,
  overrides: Partial<ArchivedQuestion> = {},
): ArchivedQuestion {
  return {
    ...adminQuestion(type),
    archivedAt: '2026-10-20T15:30:00.000Z',
    ...overrides,
  };
}

/**
 * 12.2-13: branch builders. A branch is what the member read (no name, T-12.2-03) or the admin read
 * (name included) returns; ids are stable UUID-shaped strings so a test can name them.
 */
let branchCounter = 0;

/** A branch of the MEMBER read: the opener, the opening answers, no name. */
export function branch(overrides: Partial<MemberBranch> = {}): MemberBranch {
  branchCounter += 1;
  return {
    id: uuid(3000 + branchCounter),
    openerQuestionId: uuid(1),
    values: [],
    ...overrides,
  };
}

/** A branch of the ADMIN read: the only shape with a name. */
export function adminBranch(overrides: Partial<AdminBranch> = {}): AdminBranch {
  branchCounter += 1;
  return {
    id: uuid(4000 + branchCounter),
    openerQuestionId: uuid(501),
    values: [],
    name: null,
    revision: 1,
    archivedAt: null,
    questionCount: 0,
    answerCount: 0,
    ...overrides,
  };
}

/**
 * The contracts' clinic fixture (`PROFILE_FORM_CHAIN_FIXTURE`, the parity table's own tree) as the web reads
 * it: Q1 (three options) opens B1 on "tem" and B4 on "aprende"; B1 holds Q2 (yes/no, opens B2 on true) and
 * Q3; B2 holds Q4 and Q5 (yes/no, opens B3 on true); B3 holds Q6; B4 holds Q7. One step, titles in pt-BR.
 */
export const CLINIC_OPTION_IDS = {
  tem: '24000000-0000-4000-8000-0000000000e1',
  trabalha: '24000000-0000-4000-8000-0000000000e2',
  aprende: '24000000-0000-4000-8000-0000000000e3',
} as const;

const CLINIC_TITLES: Record<string, string> = {
  Q1: 'Você tem clínica, trabalha em clínica ou está aprendendo?',
  Q2: 'A clínica tem equipe?',
  Q3: 'Nome da clínica',
  Q4: 'Quantos profissionais?',
  Q5: 'Tem sócio?',
  Q6: 'Nome do sócio',
  Q7: 'Onde estuda?',
};

const CLINIC_OPTION_LABELS = [
  { id: CLINIC_OPTION_IDS.tem, label: 'Tenho uma clínica' },
  { id: CLINIC_OPTION_IDS.trabalha, label: 'Trabalho em uma clínica' },
  { id: CLINIC_OPTION_IDS.aprende, label: 'Estou aprendendo' },
];

/** The id of a clinic question or branch by its key (`Q1`..`Q7`, `B1`..`B4`). */
export function clinicId(key: string): string {
  const found =
    PROFILE_FORM_CHAIN_FIXTURE.questions.find((item) => item.key === key) ??
    PROFILE_FORM_CHAIN_FIXTURE.branches.find((item) => item.key === key);
  if (found === undefined) throw new Error(`unknown clinic key ${key}`);
  return found.id;
}

/** The clinic form as a member reads it; `stored` is the stored answer by question key (`Q1`..`Q7`). */
export function clinicForm(stored: Record<string, unknown> = {}): MemberForm {
  const questions = PROFILE_FORM_CHAIN_FIXTURE.questions.map((item) =>
    question(item.type, {
      id: item.id,
      title: CLINIC_TITLES[item.key] ?? item.key,
      required: item.required,
      branchId: item.branchId,
      options: item.key === 'Q1' ? CLINIC_OPTION_LABELS.map((option) => ({ ...option })) : [],
      answer: (stored[item.key] ?? null) as MemberQuestion['answer'],
    }),
  );
  return form(questions, {
    branches: PROFILE_FORM_CHAIN_FIXTURE.branches.map((item) =>
      branch({
        id: item.id,
        openerQuestionId: clinicId(item.openerKey),
        values: [...item.values],
      }),
    ),
  });
}

/**
 * The clinic form as the builder reads it (one step, branches with no name). The questions are stored in TREE
 * order, as the server always stores them (D-652): Q1, then B1 (Q2 with B2 (Q4, Q5 with B3 (Q6)), Q3), then B4 (Q7).
 */
const CLINIC_TREE_ORDER = ['Q1', 'Q2', 'Q4', 'Q5', 'Q6', 'Q3', 'Q7'];

export function clinicAdminList(): AdminQuestionList {
  const step = adminStep({ id: ADMIN_STEP_ID, title: 'Etapa 1', position: 1, questionCount: 7 });
  const opens: Record<string, number> = { Q1: 3, Q2: 2, Q5: 1 };
  const ordered = CLINIC_TREE_ORDER.map((key) => {
    const found = PROFILE_FORM_CHAIN_FIXTURE.questions.find((item) => item.key === key);
    if (found === undefined) throw new Error(`unknown clinic key ${key}`);
    return found;
  });
  const questions = ordered.map((item, index) =>
    adminQuestion(item.type, {
      id: item.id,
      stepId: step.id,
      title: CLINIC_TITLES[item.key] ?? item.key,
      required: item.required,
      branchId: item.branchId,
      options:
        item.key === 'Q1'
          ? CLINIC_OPTION_LABELS.map((option) => ({ ...option, answerCount: 0 }))
          : [],
      position: index + 1,
      opensCount: opens[item.key] ?? 0,
    }),
  );
  const count = (branchId: string) => questions.filter((q) => q.branchId === branchId).length;
  return adminQuestionList(questions, {
    steps: [step],
    branches: PROFILE_FORM_CHAIN_FIXTURE.branches.map((item) =>
      adminBranch({
        id: item.id,
        openerQuestionId: clinicId(item.openerKey),
        values: [...item.values],
        questionCount: count(item.id),
      }),
    ),
  });
}
