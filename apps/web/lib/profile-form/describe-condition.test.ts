import { describe, expect, it } from 'vitest';
import { describeCondition, formatDisjunction } from './describe-condition';
import { options, question } from './test-fixtures';

/**
 * 12.1-13 task 3 (D-621, UI-D-650): the values of the condition sentence. The words around them live in
 * the catalog; nothing here types a sentence.
 */

describe('describeCondition: the opener title and the option labels (UI-D-650)', () => {
  const opts = options('Primeira', 'Segunda', 'Terceira');
  const [first, , third] = opts;

  it('lists the labels in the opener own option order, not the condition order', () => {
    const opener = question('multiple_choice', { title: 'Qual área?', options: opts });
    const byId = new Map([[opener.id, opener]]);
    const described = describeCondition(
      { questionId: opener.id, values: [third?.id ?? '', first?.id ?? ''] },
      byId,
    );
    expect(described).toEqual({
      yesNo: false,
      openerTitle: 'Qual área?',
      labels: ['Primeira', 'Terceira'],
    });
  });

  it('names a yes/no opener and leaves the words Sim and Não to the catalog', () => {
    const opener = question('yes_no', { title: 'Tem clínica?' });
    const byId = new Map([[opener.id, opener]]);
    expect(describeCondition({ questionId: opener.id, values: ['false'] }, byId)).toEqual({
      yesNo: true,
      openerTitle: 'Tem clínica?',
      values: ['false'],
    });
    expect(describeCondition({ questionId: opener.id, values: ['false', 'true'] }, byId)).toEqual({
      yesNo: true,
      openerTitle: 'Tem clínica?',
      values: ['true', 'false'],
    });
  });

  it('is null when the opener is not in the list', () => {
    expect(
      describeCondition(
        { questionId: '00000000-0000-4000-8000-00000000dead', values: ['x'] },
        new Map(),
      ),
    ).toBeNull();
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
