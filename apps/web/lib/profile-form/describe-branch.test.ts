import { describe, expect, it } from 'vitest';
import { capAnswers, describeBranch, formatDisjunction } from './describe-branch';
import { adminBranch, clinicAdminList, clinicId, options, question } from './test-fixtures';

/**
 * 12.2-13 task 1 (D-642, UI-D-666, UI-D-676): the label of a branch as structured values. The words around
 * them live in the catalog; nothing here types a sentence and no catalog is read.
 */

const list = clinicAdminList();
const byId = new Map(list.questions.map((item) => [item.id, item]));
const branchOf = (key: string) => {
  const found = list.branches?.find((item) => item.id === clinicId(key));
  if (found === undefined) throw new Error(`no clinic branch ${key}`);
  return found;
};

describe('describeBranch: an unnamed branch gives the condition parts (D-642)', () => {
  it('lists the labels of the opener in the opener own option order', () => {
    expect(describeBranch(branchOf('B1'), byId)).toStrictEqual({
      yesNo: false,
      openerTitle: 'Você tem clínica, trabalha em clínica ou está aprendendo?',
      labels: ['Tenho uma clínica'],
    });
    const both = adminBranch({
      openerQuestionId: clinicId('Q1'),
      values: ['24000000-0000-4000-8000-0000000000e3', '24000000-0000-4000-8000-0000000000e1'],
    });
    expect(describeBranch(both, byId)).toStrictEqual({
      yesNo: false,
      openerTitle: 'Você tem clínica, trabalha em clínica ou está aprendendo?',
      labels: ['Tenho uma clínica', 'Estou aprendendo'],
    });
  });

  it('names the answers of a yes/no opener as true then false', () => {
    expect(describeBranch(branchOf('B2'), byId)).toStrictEqual({
      yesNo: true,
      openerTitle: 'A clínica tem equipe?',
      values: ['true'],
    });
    const either = adminBranch({ openerQuestionId: clinicId('Q2'), values: ['false', 'true'] });
    expect(describeBranch(either, byId)).toStrictEqual({
      yesNo: true,
      openerTitle: 'A clínica tem equipe?',
      values: ['true', 'false'],
    });
  });

  it('is null when the opener is not among the questions', () => {
    const lost = adminBranch({
      openerQuestionId: '00000000-0000-4000-8000-00000000dead',
      values: ['true'],
    });
    expect(describeBranch(lost, byId)).toBeNull();
    expect(describeBranch(branchOf('B1'), new Map())).toBeNull();
  });
});

describe('describeBranch: a named branch keeps the answers visible (D-642, UI-D-666)', () => {
  it('adds the name to the same condition parts', () => {
    const named = { ...branchOf('B1'), name: 'Donos de clínica' };
    expect(describeBranch(named, byId)).toStrictEqual({
      name: 'Donos de clínica',
      yesNo: false,
      openerTitle: 'Você tem clínica, trabalha em clínica ou está aprendendo?',
      labels: ['Tenho uma clínica'],
    });
  });

  it('treats a blank or null name as no name', () => {
    expect(describeBranch({ ...branchOf('B2'), name: '   ' }, byId)).not.toHaveProperty('name');
    expect(describeBranch({ ...branchOf('B2'), name: null }, byId)).not.toHaveProperty('name');
  });

  it('works from the member shape too, which has no name to carry', () => {
    const opener = question('yes_no', { title: 'Tem sócio?' });
    const described = describeBranch(
      { openerQuestionId: opener.id, values: ['false'] },
      new Map([[opener.id, opener]]),
    );
    expect(described).toStrictEqual({ yesNo: true, openerTitle: 'Tem sócio?', values: ['false'] });
  });

  it('does not change what it is given', () => {
    const input = { ...branchOf('B1'), name: 'Donos' };
    const before = JSON.stringify(input);
    describeBranch(input, byId);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('capAnswers: the Fluxo edge shows at most four answers (UI-D-676)', () => {
  const opts = options('A', 'B', 'C', 'D', 'E', 'F').map((option) => option.label);

  it('shows all four when there are four or fewer', () => {
    expect(capAnswers(opts.slice(0, 4), 4)).toEqual({ shown: opts.slice(0, 4), more: 0 });
    expect(capAnswers(opts.slice(0, 1), 4)).toEqual({ shown: ['A'], more: 0 });
    expect(capAnswers([], 4)).toEqual({ shown: [], more: 0 });
  });

  it('caps at four and counts the rest', () => {
    expect(capAnswers(opts, 4)).toEqual({ shown: ['A', 'B', 'C', 'D'], more: 2 });
    expect(capAnswers(opts.slice(0, 5), 4)).toEqual({ shown: ['A', 'B', 'C', 'D'], more: 1 });
  });

  it('defaults the cap to four and honours another cap', () => {
    expect(capAnswers(opts)).toEqual({ shown: ['A', 'B', 'C', 'D'], more: 2 });
    expect(capAnswers(opts, 2)).toEqual({ shown: ['A', 'B'], more: 4 });
  });
});

describe('formatDisjunction: the pt-BR “A”, “B” ou “C” list', () => {
  it('joins quoted labels with the pt-BR disjunction', () => {
    expect(formatDisjunction(['A', 'B', 'C'])).toBe('“A”, “B” ou “C”');
    expect(formatDisjunction(['A', 'B'])).toBe('“A” ou “B”');
    expect(formatDisjunction(['A'])).toBe('“A”');
    expect(formatDisjunction([])).toBe('');
  });
});
