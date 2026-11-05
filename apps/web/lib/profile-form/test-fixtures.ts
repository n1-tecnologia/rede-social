import type {
  AdminQuestion,
  AdminQuestionList,
  AdminStep,
  ArchivedQuestion,
  MemberForm,
  MemberQuestion,
  ProfileFormType,
} from '@rede-social/contracts/profile-form';

/**
 * Builders for the profile form's component and state tests (12-12). A question is what
 * `GET /v1/me/profile-form` returns; ids are stable UUID-shaped strings so a test can name them.
 */

let counter = 0;

export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

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
