import type {
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
