import { PROFILE_FORM_VISIBILITY_CASES } from '@rede-social/contracts/profile-form';
import { describe, expect, it } from 'vitest';
import { form, options, question } from './test-fixtures';
import { tokensOfDraft, visibleQuestionIds } from './visibility';

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
