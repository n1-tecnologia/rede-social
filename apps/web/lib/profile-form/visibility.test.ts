import type { MemberQuestion } from '@rede-social/contracts/profile-form';
import {
  PROFILE_FORM_CHAIN_CASES,
  PROFILE_FORM_CHAIN_FIXTURE,
} from '@rede-social/contracts/profile-form-branches';
import { describe, expect, it } from 'vitest';
import { initialAnswers } from './form-state';
import {
  branch,
  CLINIC_OPTION_IDS,
  clinicForm,
  clinicId,
  form,
  options,
  question,
} from './test-fixtures';
import {
  answersToErase,
  isNotApplicable,
  isNotApplicableInTree,
  storedVisibleQuestionIds,
  tokensOfDraft,
  visibleQuestionIds,
} from './visibility';

/**
 * 12.2-13 task 1 (D-641, D-644, D-645; PFORM-54): the web sees a question as visible through the contracts'
 * ONE chain rule, over the member's DRAFTS and over the STORED answers of the read.
 */

const opts = options('A', 'B', 'C');
const [optA, optB] = [opts[0]?.id ?? '', opts[1]?.id ?? ''];

function choice(...optionIds: string[]) {
  return { optionIds, other: false, otherText: '' };
}

/** A dependent question that sits in a branch of `opener` opening on `values`. */
function inBranch(
  opener: MemberQuestion,
  values: string[],
  overrides: Partial<MemberQuestion> = {},
) {
  const b = branch({ openerQuestionId: opener.id, values });
  return { b, dependent: question('short_text', { branchId: b.id, ...overrides }) };
}

describe('visibleQuestionIds over drafts (D-641)', () => {
  it('single choice opener: empty hides, a matching option shows, another option hides', () => {
    const opener = question('single_choice', { options: opts });
    const { b, dependent: shown } = inBranch(opener, [optA], { required: true });
    const f = form([opener, shown], { branches: [b] });
    expect(visibleQuestionIds(f, { [opener.id]: choice() }).has(shown.id)).toBe(false);
    expect(visibleQuestionIds(f, { [opener.id]: choice(optA) }).has(shown.id)).toBe(true);
    expect(visibleQuestionIds(f, { [opener.id]: choice(optB) }).has(shown.id)).toBe(false);
    expect(visibleQuestionIds(f, { [opener.id]: choice(optA) }).has(opener.id)).toBe(true);
  });

  it('multiple choice opener: any one ticked matching option shows the question', () => {
    const opener = question('multiple_choice', { options: opts });
    const { b, dependent: shown } = inBranch(opener, [optA, optB]);
    const f = form([opener, shown], { branches: [b] });
    expect(visibleQuestionIds(f, { [opener.id]: choice(opts[2]?.id ?? '') }).has(shown.id)).toBe(
      false,
    );
    expect(
      visibleQuestionIds(f, { [opener.id]: choice(opts[2]?.id ?? '', optB) }).has(shown.id),
    ).toBe(true);
  });

  it('yes/no opener: the true and false branches follow the draft', () => {
    const opener = question('yes_no');
    const yes = inBranch(opener, ['true']);
    const no = inBranch(opener, ['false']);
    const f = form([opener, yes.dependent, no.dependent], { branches: [yes.b, no.b] });
    const idle = visibleQuestionIds(f, { [opener.id]: null });
    expect(idle.has(yes.dependent.id) || idle.has(no.dependent.id)).toBe(false);
    const on = visibleQuestionIds(f, { [opener.id]: true });
    expect([on.has(yes.dependent.id), on.has(no.dependent.id)]).toEqual([true, false]);
    const off = visibleQuestionIds(f, { [opener.id]: false });
    expect([off.has(yes.dependent.id), off.has(no.dependent.id)]).toEqual([false, true]);
  });

  it('without drafts the opener tokens come from the stored answer of the read', () => {
    const opener = question('single_choice', {
      options: opts,
      answer: { optionId: optA, otherText: null },
    });
    const open = inBranch(opener, [optA]);
    const shut = inBranch(opener, [optB]);
    const ids = visibleQuestionIds(
      form([opener, open.dependent, shut.dependent], { branches: [open.b, shut.b] }),
    );
    expect([ids.has(open.dependent.id), ids.has(shut.dependent.id)]).toEqual([true, false]);
  });

  it('an opener or a branch the form does not hold hides the question; an unconditional one is always shown', () => {
    const lost = branch({
      openerQuestionId: '00000000-0000-4000-8000-00000000dead',
      values: [optA],
    });
    const orphan = question('short_text', { branchId: lost.id });
    const unknown = question('short_text', { branchId: '00000000-0000-4000-8000-00000000beef' });
    const plain = question('short_text');
    const ids = visibleQuestionIds(form([orphan, unknown, plain], { branches: [lost] }), {});
    expect([ids.has(orphan.id), ids.has(unknown.id), ids.has(plain.id)]).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('tokensOfDraft turns a draft into the same tokens the stored answer would give', () => {
    const single = question('single_choice', { options: opts });
    expect(tokensOfDraft(single, choice(optA))).toEqual([optA]);
    expect(tokensOfDraft(single, choice())).toEqual([]);
    expect(tokensOfDraft(single, { optionIds: [], other: true, otherText: 'x' })).toEqual([]);
    const yn = question('yes_no');
    expect(tokensOfDraft(yn, true)).toEqual(['true']);
    expect(tokensOfDraft(yn, false)).toEqual(['false']);
    expect(tokensOfDraft(yn, null)).toEqual([]);
  });
});

describe('a form without branches (D-641)', () => {
  it('reads as a form with none: everything unconditional is visible', () => {
    const a = question('short_text');
    const b = question('short_text');
    const ids = visibleQuestionIds({ questions: [a, b] }, {});
    expect([...ids]).toEqual([a.id, b.id]);
  });

  it('no longer hides a question for the retired per-question condition', () => {
    const opener = question('single_choice', { options: opts });
    const old = question('short_text', { condition: { questionId: opener.id, values: [optA] } });
    expect(visibleQuestionIds(form([opener, old]), { [opener.id]: choice(optB) }).has(old.id)).toBe(
      true,
    );
  });
});

describe('the chain: a question is visible only when every branch above it is open (D-644)', () => {
  const tem = { optionIds: [CLINIC_OPTION_IDS.tem], other: false, otherText: '' };
  const trabalha = { optionIds: [CLINIC_OPTION_IDS.trabalha], other: false, otherText: '' };

  it('shows Q1 to Q5 and not Q6 for Q1 tem and Q2 sim', () => {
    const f = clinicForm();
    const ids = visibleQuestionIds(f, {
      [clinicId('Q1')]: tem,
      [clinicId('Q2')]: true,
    });
    expect(f.questions.map((q) => ids.has(q.id))).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it('a change at the top closes every level below it', () => {
    const f = clinicForm();
    const ids = visibleQuestionIds(f, {
      [clinicId('Q1')]: trabalha,
      [clinicId('Q2')]: true,
      [clinicId('Q5')]: true,
    });
    expect([...ids]).toEqual([clinicId('Q1')]);
  });

  it('answersToErase lists, in form order, the titles that had a stored answer and are now closed', () => {
    const f = clinicForm({
      Q1: { optionId: CLINIC_OPTION_IDS.tem, otherText: null },
      Q2: true,
      Q3: 'Clínica Aurora',
      Q4: 4,
      Q5: true,
      Q6: 'Marina',
    });
    const erase = answersToErase(f, { ...initialAnswers(f), [clinicId('Q1')]: trabalha });
    expect(erase.map((row) => row.id)).toEqual([
      clinicId('Q2'),
      clinicId('Q3'),
      clinicId('Q4'),
      clinicId('Q5'),
      clinicId('Q6'),
    ]);
    expect(erase.map((row) => row.title)).toEqual([
      'A clínica tem equipe?',
      'Nome da clínica',
      'Quantos profissionais?',
      'Tem sócio?',
      'Nome do sócio',
    ]);
    expect(JSON.stringify(erase)).not.toContain('Aurora');
    expect(JSON.stringify(erase)).not.toContain('Marina');
    for (const row of erase) expect(Object.keys(row).sort()).toEqual(['id', 'title']);
  });

  it('closing only the middle branch erases what is below it and keeps the rest', () => {
    const f = clinicForm({
      Q1: { optionId: CLINIC_OPTION_IDS.tem, otherText: null },
      Q2: true,
      Q3: 'Clínica Aurora',
      Q4: 4,
      Q5: true,
      Q6: 'Marina',
    });
    const erase = answersToErase(f, { ...initialAnswers(f), [clinicId('Q2')]: false });
    expect(erase.map((row) => row.id)).toEqual([clinicId('Q4'), clinicId('Q5'), clinicId('Q6')]);
  });

  it('lists nothing when the drafts are the stored answers', () => {
    const f = clinicForm({
      Q1: { optionId: CLINIC_OPTION_IDS.tem, otherText: null },
      Q2: true,
      Q4: 4,
    });
    expect(answersToErase(f, initialAnswers(f))).toEqual([]);
  });

  it('does not list a closed question that has no stored answer', () => {
    const f = clinicForm({ Q1: { optionId: CLINIC_OPTION_IDS.tem, otherText: null }, Q2: true });
    const erase = answersToErase(f, { ...initialAnswers(f), [clinicId('Q1')]: trabalha });
    expect(erase.map((row) => row.id)).toEqual([clinicId('Q2')]);
  });
});

describe('PROFILE_FORM_CHAIN_CASES: the web agrees with the shared parity table (PFORM-54, T-12.2-05)', () => {
  /** The member form of a table fixture with the stored answers of a row, by question key. */
  const formOf = (row: (typeof PROFILE_FORM_CHAIN_CASES)[number]) => {
    const fixture = row.fixture ?? PROFILE_FORM_CHAIN_FIXTURE;
    return form(
      fixture.questions.map((item) =>
        question(item.type, {
          id: item.id,
          title: item.key,
          required: item.required,
          branchId: item.branchId,
          answer: (row.stored[item.key] ?? null) as MemberQuestion['answer'],
        }),
      ),
      {
        branches: fixture.branches.map((item) =>
          branch({
            id: item.id,
            openerQuestionId: (
              fixture.questions.find((q) => q.key === item.openerKey) ?? { id: '' }
            ).id,
            values: [...item.values],
          }),
        ),
      },
    );
  };
  const keyOf = (row: (typeof PROFILE_FORM_CHAIN_CASES)[number], id: string) =>
    (row.fixture ?? PROFILE_FORM_CHAIN_FIXTURE).questions.find((q) => q.id === id)?.key;

  it('the table holds the eleven rows', () => {
    expect(PROFILE_FORM_CHAIN_CASES).toHaveLength(11);
  });

  for (const row of PROFILE_FORM_CHAIN_CASES) {
    it(`${row.name}: the stored answers show the table's visible keys`, () => {
      const f = formOf(row);
      const keys = [...storedVisibleQuestionIds(f)].map((id) => keyOf(row, id));
      expect(keys).toEqual([...row.visible]);
    });

    it(`${row.name}: the drafts of the stored answers agree and erase exactly the purged keys`, () => {
      const f = formOf(row);
      const drafts = initialAnswers(f);
      expect([...visibleQuestionIds(f, drafts)].map((id) => keyOf(row, id))).toEqual([
        ...row.visible,
      ]);
      const answered = f.questions.filter((q) => q.answer !== null).map((q) => q.id);
      const purged = answersToErase(f, drafts).map((erased) => keyOf(row, erased.id));
      expect(purged).toEqual([...row.purged]);
      for (const id of answered) expect(typeof id).toBe('string');
    });
  }
});

describe('the readers rules: stored equals visible (D-645)', () => {
  it('storedVisibleQuestionIds omits a question whose branch the stored answers close', () => {
    const f = clinicForm({ Q1: { optionId: CLINIC_OPTION_IDS.tem, otherText: null } });
    expect([...storedVisibleQuestionIds(f)]).toEqual([
      clinicId('Q1'),
      clinicId('Q2'),
      clinicId('Q3'),
    ]);
  });

  describe('isNotApplicableInTree: a staff row whose chain the opener rows do not open reads Não se aplica', () => {
    const branches = clinicForm().branches ?? [];
    const rows = (values: Record<string, unknown>) =>
      new Map(
        PROFILE_FORM_CHAIN_FIXTURE.questions.map((q) => [
          q.id,
          { value: values[q.key] ?? null, branchId: q.branchId },
        ]),
      );
    const row = (key: string) => ({
      questionId: clinicId(key),
      branchId: PROFILE_FORM_CHAIN_FIXTURE.questions.find((q) => q.key === key)?.branchId ?? null,
      value: null,
    });
    const tem = { optionId: CLINIC_OPTION_IDS.tem, otherText: null };

    it('is false for an unconditional row and for a row whose whole chain is open', () => {
      const all = rows({ Q1: tem, Q2: true, Q5: true });
      expect(isNotApplicableInTree(row('Q1'), all, branches)).toBe(false);
      expect(isNotApplicableInTree(row('Q3'), all, branches)).toBe(false);
      expect(isNotApplicableInTree(row('Q4'), all, branches)).toBe(false);
      expect(isNotApplicableInTree(row('Q6'), all, branches)).toBe(false);
    });

    it('is true when any branch on the chain is closed, however deep', () => {
      const closedMiddle = rows({ Q1: tem, Q2: false, Q5: true });
      expect(isNotApplicableInTree(row('Q3'), closedMiddle, branches)).toBe(false);
      expect(isNotApplicableInTree(row('Q4'), closedMiddle, branches)).toBe(true);
      expect(isNotApplicableInTree(row('Q6'), closedMiddle, branches)).toBe(true);
      const closedTop = rows({
        Q1: { optionId: CLINIC_OPTION_IDS.trabalha, otherText: null },
        Q2: true,
        Q5: true,
      });
      expect(isNotApplicableInTree(row('Q2'), closedTop, branches)).toBe(true);
      expect(isNotApplicableInTree(row('Q6'), closedTop, branches)).toBe(true);
    });

    it('is true when an opener row is missing or holds no value, and for an unknown branch', () => {
      expect(isNotApplicableInTree(row('Q2'), new Map(), branches)).toBe(true);
      expect(isNotApplicableInTree(row('Q2'), rows({}), branches)).toBe(true);
      expect(
        isNotApplicableInTree(
          { questionId: 'q', branchId: '00000000-0000-4000-8000-00000000beef', value: null },
          rows({ Q1: tem }),
          branches,
        ),
      ).toBe(true);
    });

    it('returns a plain boolean and never an answer value', () => {
      const all = rows({ Q1: tem, Q2: true });
      expect(typeof isNotApplicableInTree(row('Q4'), all, branches)).toBe('boolean');
    });
  });

  it('isNotApplicable (12.1): the retired per-question condition still reads for the compatibility window', () => {
    const openerId = '00000000-0000-4000-8000-0000000000a1';
    const rowsById = new Map<string, { value: unknown }>([
      [openerId, { value: { optionId: optA, otherText: null } }],
    ]);
    const cond = (values: string[]) => ({ questionId: openerId, values });
    const row = (condition: ReturnType<typeof cond> | null) => ({
      questionId: 'q',
      condition,
      value: null,
    });
    expect(isNotApplicable(row(cond([optB])), rowsById)).toBe(true);
    expect(isNotApplicable(row(cond([optA])), rowsById)).toBe(false);
    expect(isNotApplicable(row(null), rowsById)).toBe(false);
    const emptyOpener = new Map<string, { value: unknown }>([[openerId, { value: null }]]);
    expect(isNotApplicable(row(cond([optA])), emptyOpener)).toBe(true);
    expect(isNotApplicable(row(cond([optA])), new Map())).toBe(true);
  });
});
