import { PROFILE_FORM_VISIBILITY_CASES } from '@rede-social/contracts/profile-form';
import { describe, expect, it } from 'vitest';
import { form, options, question } from './test-fixtures';
import {
  answersToErase,
  isNotApplicable,
  storedVisibleQuestionIds,
  tokensOfDraft,
  visibleQuestionIds,
} from './visibility';

/**
 * 12.1-13 task 1 (D-621, D-631, UI-D-662; PFORM-41): the web sees a question as visible through the
 * contracts' one rule, over the member's DRAFTS and over the STORED answers of the read.
 */

const opts = options('A', 'B', 'C');
const [optA, optB] = [opts[0]?.id ?? '', opts[1]?.id ?? ''];

function choice(...optionIds: string[]) {
  return { optionIds, other: false, otherText: '' };
}

describe('visibleQuestionIds over drafts (D-621)', () => {
  it('single choice opener: empty hides, a matching option shows, another option hides', () => {
    const opener = question('single_choice', { options: opts });
    const shown = question('short_text', {
      required: true,
      condition: { questionId: opener.id, values: [optA] },
    });
    const f = form([opener, shown]);
    expect(visibleQuestionIds(f, { [opener.id]: choice() }).has(shown.id)).toBe(false);
    expect(visibleQuestionIds(f, { [opener.id]: choice(optA) }).has(shown.id)).toBe(true);
    expect(visibleQuestionIds(f, { [opener.id]: choice(optB) }).has(shown.id)).toBe(false);
    expect(visibleQuestionIds(f, { [opener.id]: choice(optA) }).has(opener.id)).toBe(true);
  });

  it('multiple choice opener: any one ticked matching option shows the question', () => {
    const opener = question('multiple_choice', { options: opts });
    const shown = question('short_text', {
      condition: { questionId: opener.id, values: [optA, optB] },
    });
    const f = form([opener, shown]);
    expect(visibleQuestionIds(f, { [opener.id]: choice(opts[2]?.id ?? '') }).has(shown.id)).toBe(
      false,
    );
    expect(
      visibleQuestionIds(f, { [opener.id]: choice(opts[2]?.id ?? '', optB) }).has(shown.id),
    ).toBe(true);
  });

  it('yes/no opener: the true and false conditions follow the draft', () => {
    const opener = question('yes_no');
    const whenYes = question('short_text', {
      condition: { questionId: opener.id, values: ['true'] },
    });
    const whenNo = question('short_text', {
      condition: { questionId: opener.id, values: ['false'] },
    });
    const f = form([opener, whenYes, whenNo]);
    const idle = visibleQuestionIds(f, { [opener.id]: null });
    expect(idle.has(whenYes.id) || idle.has(whenNo.id)).toBe(false);
    const yes = visibleQuestionIds(f, { [opener.id]: true });
    expect([yes.has(whenYes.id), yes.has(whenNo.id)]).toEqual([true, false]);
    const no = visibleQuestionIds(f, { [opener.id]: false });
    expect([no.has(whenYes.id), no.has(whenNo.id)]).toEqual([false, true]);
  });

  it('without drafts the opener tokens come from the stored answer of the read', () => {
    const opener = question('single_choice', {
      options: opts,
      answer: { optionId: optA, otherText: null },
    });
    const open = question('short_text', { condition: { questionId: opener.id, values: [optA] } });
    const shut = question('short_text', { condition: { questionId: opener.id, values: [optB] } });
    const ids = visibleQuestionIds(form([opener, open, shut]));
    expect([ids.has(open.id), ids.has(shut.id)]).toEqual([true, false]);
  });

  it('an opener that is not in the form hides the question; an unconditional one is always shown', () => {
    const orphan = question('short_text', {
      condition: { questionId: '00000000-0000-4000-8000-00000000dead', values: [optA] },
    });
    const plain = question('short_text');
    const ids = visibleQuestionIds(form([orphan, plain]), {});
    expect([ids.has(orphan.id), ids.has(plain.id)]).toEqual([false, true]);
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

describe('PROFILE_FORM_VISIBILITY_CASES: the web agrees with the shared parity table (PFORM-41)', () => {
  for (const row of PROFILE_FORM_VISIBILITY_CASES) {
    it(row.name, () => {
      const opener = question('short_text', { answer: row.stored as never });
      const shown = question('short_text', {
        condition: { questionId: opener.id, values: row.values },
      });
      expect(visibleQuestionIds(form([opener, shown])).has(shown.id)).toBe(row.expected);
    });
  }
});

describe('answersToErase: the titles of the answers a save would delete (D-626, T-12.1-11)', () => {
  const secret = 'resposta-que-nunca-sai';
  const setup = () => {
    const opener = question('single_choice', {
      title: 'Abridora',
      options: opts,
      answer: { optionId: optA, otherText: null },
    });
    const dependent = question('short_text', {
      title: 'Dependente',
      answer: secret,
      condition: { questionId: opener.id, values: [optA] },
    });
    const neverAnswered = question('short_text', {
      title: 'Sem resposta',
      condition: { questionId: opener.id, values: [optA] },
    });
    return { opener, dependent, neverAnswered, f: form([opener, dependent, neverAnswered]) };
  };

  it('lists a stored answer that the draft closes, in form order, with exactly an id and a title', () => {
    const { opener, dependent, f } = setup();
    const erase = answersToErase(f, { [opener.id]: choice(optB) });
    expect(erase).toEqual([{ id: dependent.id, title: 'Dependente' }]);
    expect(Object.keys(erase[0] ?? {}).sort()).toEqual(['id', 'title']);
    expect(JSON.stringify(erase)).not.toContain(secret);
  });

  it('lists nothing when the opener changes within the matching set, or is untouched', () => {
    const { opener, f } = setup();
    expect(answersToErase(f, { [opener.id]: choice(optA, optB) })).toEqual([]);
    expect(answersToErase(f, { [opener.id]: choice(optA) })).toEqual([]);
  });

  it('does not list a hidden question that has no stored answer', () => {
    const { opener, neverAnswered, f } = setup();
    const ids = answersToErase(f, { [opener.id]: choice(optB) }).map((row) => row.id);
    expect(ids).not.toContain(neverAnswered.id);
  });
});

describe('the readers rules: stored equals visible (D-634, UI-D-659)', () => {
  it('storedVisibleQuestionIds omits a conditional question whose opener does not match', () => {
    const opener = question('single_choice', {
      options: opts,
      answer: { optionId: optA, otherText: null },
    });
    const plain = question('short_text');
    const open = question('short_text', { condition: { questionId: opener.id, values: [optA] } });
    const shut = question('short_text', { condition: { questionId: opener.id, values: [optB] } });
    const ids = storedVisibleQuestionIds(form([opener, plain, open, shut]));
    expect([...ids]).toEqual([opener.id, plain.id, open.id]);
  });

  it('isNotApplicable: a staff row whose condition the opener row does not meet reads Não se aplica', () => {
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
