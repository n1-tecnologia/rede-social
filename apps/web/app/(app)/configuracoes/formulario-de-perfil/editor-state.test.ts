import type { AdminQuestion } from '@rede-social/contracts/profile-form';
import { describe, expect, it } from 'vitest';
import { adminQuestion, uuid } from '@/lib/profile-form/test-fixtures';
import {
  addOptionRow,
  blankDraft,
  canSave,
  changeType,
  checkDraftLocks,
  draftFromQuestion,
  draftLock,
  hasChanges,
  hasErrors,
  isDirty,
  type LockDefinition,
  type LockInput,
  lockFlags,
  moveOptionRow,
  narrowsLimits,
  type OptionDraft,
  parseLimits,
  removeOptionRow,
  renameOptionRow,
  reopeningOf,
  replaceDraftFrom,
  serverFieldError,
  serverLimitsError,
  serverOptionsErrors,
  toCreateBody,
  toUpdateBody,
  validateDraft,
  validateOptions,
} from './editor-state';

/**
 * 12-16 Task 1 (D-590, D-592, UI-D-569): the pure draft of the question editor, with no rendering. The
 * rules are the sheet's; the server repeats every one of them.
 */

describe('blankDraft', () => {
  it('starts with no type, nothing typed, both switches off and two empty option rows', () => {
    const draft = blankDraft();
    expect(draft.type).toBeNull();
    expect(draft.title).toBe('');
    expect(draft.helpText).toBe('');
    expect(draft.required).toBe(false);
    expect(draft.showOnProfile).toBe(false);
    expect(draft.allowOther).toBe(false);
    expect(draft.options).toHaveLength(2);
    expect(draft.options.every((option) => option.label === '' && option.id === undefined)).toBe(
      true,
    );
    expect(new Set(draft.options.map((option) => option.key)).size).toBe(2);
  });
});

describe('canSave', () => {
  it('needs a type and a non-empty title', () => {
    const draft = blankDraft();
    expect(canSave(draft)).toBe(false);
    expect(canSave({ ...draft, type: 'short_text' })).toBe(false);
    expect(canSave({ ...draft, type: 'short_text', title: '   ' })).toBe(false);
    expect(canSave({ ...draft, title: 'Cargo' })).toBe(false);
    expect(canSave({ ...draft, type: 'short_text', title: 'Cargo' })).toBe(true);
  });
});

describe('changeType', () => {
  it('keeps the options and "Outro" between two choice types', () => {
    const draft = {
      ...changeType(blankDraft(), 'dropdown'),
      allowOther: true,
    };
    draft.options[0] = {
      ...draft.options[0],
      label: 'Instagram',
    } as (typeof draft.options)[number];
    const next = changeType(draft, 'single_choice');
    expect(next.type).toBe('single_choice');
    expect(next.options).toBe(draft.options);
    expect(next.allowOther).toBe(true);
  });

  it('drops the options and "Outro" for a type that cannot carry them', () => {
    const next = changeType({ ...blankDraft(), type: 'dropdown', allowOther: true }, 'short_text');
    expect(next.options).toEqual([]);
    expect(next.allowOther).toBe(false);
  });

  it('seeds two empty rows when a non-choice question becomes a choice one', () => {
    const next = changeType(
      { ...blankDraft(), type: 'short_text', options: [] },
      'multiple_choice',
    );
    expect(next.options).toHaveLength(2);
    expect(next.options.every((option) => option.label === '')).toBe(true);
  });

  it('keeps a limit pair only when the type stays number or date', () => {
    const base = { ...blankDraft(), type: 'number' as const, min: '1', max: '9' };
    expect(changeType(base, 'number')).toMatchObject({ min: '1', max: '9' });
    expect(changeType(base, 'date')).toMatchObject({ min: '', max: '' });
    expect(changeType(base, 'rating')).toMatchObject({ min: '', max: '' });
  });

  it('keeps the title, the help text and the switches', () => {
    const base = {
      ...blankDraft(),
      type: 'short_text' as const,
      title: 'Cargo',
      helpText: 'Seu cargo atual',
      required: true,
      showOnProfile: true,
    };
    expect(changeType(base, 'long_text')).toMatchObject({
      title: 'Cargo',
      helpText: 'Seu cargo atual',
      required: true,
      showOnProfile: true,
    });
  });
});

describe('toCreateBody', () => {
  it('trims the texts and turns an empty help text into null', () => {
    const body = toCreateBody({
      ...blankDraft(),
      type: 'short_text',
      title: '  Qual é o seu cargo?  ',
      helpText: '   ',
      required: true,
    });
    expect(body).toEqual({
      type: 'short_text',
      title: 'Qual é o seu cargo?',
      helpText: null,
      required: true,
      showOnProfile: false,
      allowOther: false,
      options: [],
      limits: {},
    });
  });

  it('refuses to build a body without a type', () => {
    expect(() => toCreateBody({ ...blankDraft(), title: 'x' })).toThrow();
  });

  it('carries the options and "Outro" only for a choice type', () => {
    const choice = changeType({ ...blankDraft(), title: 'Origem' }, 'single_choice');
    choice.options = [
      { key: 'a', label: ' Instagram ' },
      { key: 'b', label: 'Indicação' },
    ];
    choice.allowOther = true;
    expect(toCreateBody(choice)).toMatchObject({
      allowOther: true,
      options: [{ label: 'Instagram' }, { label: 'Indicação' }],
    });
    const text = toCreateBody({ ...choice, type: 'short_text' });
    expect(text.allowOther).toBe(false);
    expect(text.options).toEqual([]);
  });

  it('parses a number limit with the pt-BR rule and passes a date limit as the ISO day', () => {
    expect(
      toCreateBody({ ...blankDraft(), type: 'number', title: 'Idade', min: '1.000,5', max: '2000' })
        .limits,
    ).toEqual({ min: 1000.5, max: 2000 });
    expect(
      toCreateBody({
        ...blankDraft(),
        type: 'date',
        title: 'Início',
        min: '2026-01-01',
        max: '',
      }).limits,
    ).toEqual({ min: '2026-01-01' });
    expect(
      toCreateBody({ ...blankDraft(), type: 'rating', title: 'Nota', min: '1' }).limits,
    ).toEqual({});
  });
});

describe('parseLimits', () => {
  it('flags a number text that is not a number and ignores empty ones', () => {
    expect(parseLimits({ type: 'number', min: 'abc', max: '' })).toEqual({
      limits: {},
      invalid: { min: true, max: false },
    });
    expect(parseLimits({ type: 'short_text', min: '1', max: '2' })).toEqual({
      limits: {},
      invalid: { min: false, max: false },
    });
  });
});

describe('isDirty', () => {
  it('is false for the draft the sheet opened with and true after any change', () => {
    const initial = blankDraft();
    expect(isDirty(initial, { ...initial })).toBe(false);
    expect(isDirty(initial, { ...initial, title: 'x' })).toBe(true);
    expect(isDirty(initial, { ...initial, required: true })).toBe(true);
    expect(isDirty(initial, changeType(initial, 'short_text'))).toBe(true);
  });

  it('ignores the client row keys', () => {
    const initial = blankDraft();
    const renamed = {
      ...initial,
      options: initial.options.map((o) => ({ ...o, key: `${o.key}-x` })),
    };
    expect(isDirty(initial, renamed)).toBe(false);
  });
});

describe('validateDraft', () => {
  it('requires a title', () => {
    const errors = validateDraft({ ...blankDraft(), type: 'short_text', title: '  ' });
    expect(errors.title).toEqual({ key: 'errors.titleRequired' });
    expect(hasErrors(errors)).toBe(true);
  });

  it('caps the title at 120 and the help text at 300 code points', () => {
    const ok = validateDraft({
      ...blankDraft(),
      type: 'short_text',
      title: '😀'.repeat(120),
      helpText: '😀'.repeat(300),
    });
    expect(hasErrors(ok)).toBe(false);
    const bad = validateDraft({
      ...blankDraft(),
      type: 'short_text',
      title: '😀'.repeat(121),
      helpText: '😀'.repeat(301),
    });
    expect(bad.title).toEqual({ key: 'errors.tooLong', values: { max: 120 } });
    expect(bad.helpText).toEqual({ key: 'errors.tooLong', values: { max: 300 } });
  });

  it('is clean for a typed title', () => {
    expect(hasErrors(validateDraft({ ...blankDraft(), type: 'email', title: 'E-mail' }))).toBe(
      false,
    );
  });
});

describe('serverFieldError', () => {
  it('maps the codes a field can come back with and nothing else', () => {
    expect(serverFieldError('title', 'required')).toEqual({ key: 'errors.titleRequired' });
    expect(serverFieldError('title', 'too_long')).toEqual({
      key: 'errors.tooLong',
      values: { max: 120 },
    });
    expect(serverFieldError('helpText', 'too_long')).toEqual({
      key: 'errors.tooLong',
      values: { max: 300 },
    });
    expect(serverFieldError('helpText', 'required')).toBeNull();
    expect(serverFieldError('title', 'invalid')).toBeNull();
  });
});

const row = (key: string, label: string, id?: string): OptionDraft =>
  id === undefined ? { key, label } : { key, label, id };

describe('validateOptions (D-592, UI-D-571)', () => {
  it('is clean for two or more distinct, filled rows', () => {
    expect(validateOptions([row('a', 'Instagram'), row('b', 'Indicação')])).toBeUndefined();
  });

  it('flags fewer than two rows', () => {
    expect(validateOptions([row('a', 'Só uma')])?.issues).toEqual(['min']);
    expect(validateOptions([])?.issues).toEqual(['min']);
  });

  it('flags an empty or whitespace row and marks it', () => {
    const errors = validateOptions([row('a', 'Instagram'), row('b', '   ')]);
    expect(errors?.issues).toEqual(['empty']);
    expect(errors?.rows).toEqual({ b: 'empty' });
  });

  it('flags a repeat after trimming, accents kept and pt-BR lower case, and marks both rows', () => {
    const errors = validateOptions([row('a', 'Indicação'), row('b', '  INDICAÇÃO ')]);
    expect(errors?.issues).toEqual(['duplicate']);
    expect(errors?.rows).toEqual({ a: 'duplicate', b: 'duplicate' });
    // a different accent is a different label
    expect(validateOptions([row('a', 'Indicacao'), row('b', 'Indicação')])).toBeUndefined();
  });

  it('flags more than 20 rows, "Outro" not counted', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => row(`k${i}`, `Opção ${i}`));
    expect(validateOptions(twenty)).toBeUndefined();
    expect(validateOptions([...twenty, row('x', 'Mais uma')])?.issues).toEqual(['max']);
  });

  it('lists every sentence that applies, in the order shown', () => {
    expect(validateOptions([row('a', ''), row('b', 'x'), row('c', 'x')])?.issues).toEqual([
      'empty',
      'duplicate',
    ]);
  });
});

describe('validateDraft: options and limits', () => {
  const choice = (options: OptionDraft[]) => ({
    ...blankDraft(),
    type: 'single_choice' as const,
    title: 'Origem',
    options,
  });

  it('reports the options errors of a choice draft only', () => {
    expect(validateDraft(choice([row('a', ''), row('b', '')])).options?.issues).toEqual(['empty']);
    expect(
      validateDraft({ ...choice([row('a', '')]), type: 'short_text' }).options,
    ).toBeUndefined();
  });

  it('reports a number text that is not a number and a minimum above the maximum', () => {
    const base = { ...blankDraft(), type: 'number' as const, title: 'Idade' };
    expect(validateDraft({ ...base, min: 'abc' }).min).toEqual({ key: 'errors.numberInvalid' });
    expect(validateDraft({ ...base, max: '1,2,3' }).max).toEqual({ key: 'errors.numberInvalid' });
    expect(validateDraft({ ...base, min: '10', max: '2' }).limits).toEqual({
      key: 'limits.errNumber',
    });
    expect(hasErrors(validateDraft({ ...base, min: '2', max: '2' }))).toBe(false);
    expect(hasErrors(validateDraft({ ...base, min: '0,5', max: '1.000' }))).toBe(false);
  });

  it('reports a date minimum after the maximum', () => {
    const base = { ...blankDraft(), type: 'date' as const, title: 'Início' };
    expect(validateDraft({ ...base, min: '2026-12-31', max: '2026-01-01' }).limits).toEqual({
      key: 'limits.errDate',
    });
    expect(hasErrors(validateDraft({ ...base, min: '2026-01-01', max: '2026-01-01' }))).toBe(false);
    expect(hasErrors(validateDraft({ ...base, min: '2026-01-01' }))).toBe(false);
  });
});

describe('the option rows as pure moves', () => {
  const rows = [row('a', 'A', 'id-a'), row('b', 'B'), row('c', 'C')];

  it('adds an empty row without an id at the end', () => {
    const next = addOptionRow(rows);
    expect(next.options).toHaveLength(4);
    expect(next.options[3]).toEqual({ key: next.key, label: '' });
    expect(rows).toHaveLength(3);
  });

  it('removes a row but never below two', () => {
    expect(removeOptionRow(rows, 'b').map((o) => o.key)).toEqual(['a', 'c']);
    const two = [row('a', 'A'), row('b', 'B')];
    expect(removeOptionRow(two, 'a')).toEqual(two);
  });

  it('moves a row one place and leaves the edges alone', () => {
    expect(moveOptionRow(rows, 'b', -1).map((o) => o.key)).toEqual(['b', 'a', 'c']);
    expect(moveOptionRow(rows, 'b', 1).map((o) => o.key)).toEqual(['a', 'c', 'b']);
    expect(moveOptionRow(rows, 'a', -1).map((o) => o.key)).toEqual(['a', 'b', 'c']);
    expect(moveOptionRow(rows, 'c', 1).map((o) => o.key)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the server id when a stored option is moved or renamed', () => {
    const moved = moveOptionRow(rows, 'a', 1);
    expect(moved.find((o) => o.key === 'a')?.id).toBe('id-a');
    const renamed = renameOptionRow(rows, 'a', 'Novo nome');
    expect(renamed[0]).toEqual({ key: 'a', id: 'id-a', label: 'Novo nome' });
  });
});

describe('reopeningOf (D-585, UI-D-576)', () => {
  const optional = { id: 'q1', required: false };
  const required = { id: 'q2', required: true };

  it('a new required question reopens the form; an optional one does not', () => {
    expect(reopeningOf('create', { required: true }, null)).toEqual({
      change: 'create_required',
      kind: 'add',
    });
    expect(reopeningOf('create', { required: false }, null)).toBeNull();
  });

  it('an optional question turned required reopens it, naming the question', () => {
    expect(reopeningOf('edit', { required: true }, optional)).toEqual({
      change: 'make_required',
      kind: 'make',
      questionId: 'q1',
    });
  });

  it('a question that was already required, or that stays optional, reopens nothing', () => {
    expect(reopeningOf('edit', { required: true }, required)).toBeNull();
    expect(reopeningOf('edit', { required: false }, optional)).toBeNull();
    expect(reopeningOf('edit', { required: false }, required)).toBeNull();
  });

  it('a required replacement reopens it, naming the question it replaces', () => {
    expect(reopeningOf('replace', { required: true }, required)).toEqual({
      change: 'replace',
      kind: 'replace',
      questionId: 'q2',
    });
    expect(reopeningOf('replace', { required: false }, required)).toBeNull();
  });
});

describe('server refusals placed on the options and the limits', () => {
  it('maps the codes with a single place and nothing else', () => {
    expect(serverOptionsErrors('required')).toEqual({ issues: ['empty'], rows: {} });
    expect(serverOptionsErrors('limit_reached')).toEqual({ issues: ['max'], rows: {} });
    expect(serverOptionsErrors('invalid')).toBeNull();
    expect(serverLimitsError('number', 'out_of_range')).toEqual({ key: 'limits.errNumber' });
    expect(serverLimitsError('date', 'out_of_range')).toEqual({ key: 'limits.errDate' });
    expect(serverLimitsError('number', 'invalid')).toBeNull();
  });
});

// ── Task 3: edit, replace and the locks ───────────────────────────────────────────────────────────

const OA = { id: uuid(9001), label: 'Instagram', answerCount: 8 };
const OB = { id: uuid(9002), label: 'Indicação', answerCount: 0 };

function stored(over: Partial<AdminQuestion> = {}): AdminQuestion {
  return adminQuestion('single_choice', {
    title: 'Como conheceu?',
    helpText: 'Escolha uma',
    revision: 4,
    options: [OA, OB],
    ...over,
  });
}

describe('draftFromQuestion and replaceDraftFrom', () => {
  it('opens a stored question with its option ids, trimmed help text and limits as text', () => {
    const draft = draftFromQuestion(stored({ allowOther: true, required: true }));
    expect(draft).toMatchObject({
      type: 'single_choice',
      title: 'Como conheceu?',
      helpText: 'Escolha uma',
      required: true,
      allowOther: true,
    });
    expect(draft.options.map((o) => [o.id, o.label])).toEqual([
      [OA.id, 'Instagram'],
      [OB.id, 'Indicação'],
    ]);
    expect(draftFromQuestion(stored({ helpText: null })).helpText).toBe('');
    const number = draftFromQuestion(
      adminQuestion('number', { limits: { min: 1000.5, max: 2000 }, options: [] }),
    );
    expect([number.min, number.max]).toEqual(['1000,5', '2000']);
    const date = draftFromQuestion(
      adminQuestion('date', { limits: { min: '2026-01-01' }, options: [] }),
    );
    expect([date.min, date.max]).toEqual(['2026-01-01', '']);
  });

  it('is not dirty until something changes', () => {
    const question = stored();
    expect(isDirty(draftFromQuestion(question), draftFromQuestion(question))).toBe(false);
  });

  it('copies only the title, help text, required and showOnProfile into a replacement, with no type', () => {
    const draft = replaceDraftFrom(
      stored({ required: true, showOnProfile: true, allowOther: true }),
    );
    expect(draft).toMatchObject({
      type: null,
      title: 'Como conheceu?',
      helpText: 'Escolha uma',
      required: true,
      showOnProfile: true,
      allowOther: false,
    });
    expect(draft.options.every((option) => option.id === undefined && option.label === '')).toBe(
      true,
    );
  });
});

describe('toUpdateBody', () => {
  it('carries only the revision when nothing changed', () => {
    const question = stored();
    const body = toUpdateBody(question, draftFromQuestion(question));
    expect(body).toEqual({ revision: 4 });
    expect(hasChanges(body)).toBe(false);
  });

  it('carries the revision and exactly the keys that changed', () => {
    const question = stored();
    const draft = {
      ...draftFromQuestion(question),
      title: '  Como nos conheceu?  ',
      required: true,
      helpText: '',
    };
    const body = toUpdateBody(question, draft);
    expect(body).toEqual({
      revision: 4,
      title: 'Como nos conheceu?',
      required: true,
      helpText: null,
    });
    expect(hasChanges(body)).toBe(true);
  });

  it('sends the option ids of stored rows and none for a new row, in the new order', () => {
    const question = stored();
    const draft = draftFromQuestion(question);
    const added = addOptionRow(draft.options);
    const options = moveOptionRow(renameOptionRow(added.options, added.key, ' Evento '), OB.id, -1);
    expect(toUpdateBody(question, { ...draft, options }).options).toEqual([
      { id: OB.id, label: 'Indicação' },
      { id: OA.id, label: 'Instagram' },
      { label: 'Evento' },
    ]);
  });

  it('does not send options for a reorder-free, rename-free draft', () => {
    const question = stored();
    expect(toUpdateBody(question, draftFromQuestion(question)).options).toBeUndefined();
  });

  it('sends the new type with the options, "Outro" and limits of the new type', () => {
    const question = adminQuestion('short_text', { revision: 2, options: [] });
    const toChoice = toUpdateBody(question, {
      ...changeType(draftFromQuestion(question), 'dropdown'),
      options: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
      ],
      allowOther: true,
    });
    expect(toChoice).toMatchObject({
      revision: 2,
      type: 'dropdown',
      allowOther: true,
      options: [{ label: 'A' }, { label: 'B' }],
    });
    const toNumber = toUpdateBody(question, {
      ...changeType(draftFromQuestion(question), 'number'),
      min: '1',
    });
    expect(toNumber).toMatchObject({ type: 'number', limits: { min: 1 } });
  });

  it('turns "Outro" off when the type no longer carries it', () => {
    const question = stored({ allowOther: true, answerCount: 0, options: [OB] });
    const body = toUpdateBody(question, changeType(draftFromQuestion(question), 'short_text'));
    expect(body).toMatchObject({ type: 'short_text', allowOther: false });
    expect(body.options).toBeUndefined();
  });

  it('sends a limits pair only when it differs from the stored one', () => {
    const question = adminQuestion('number', { limits: { min: 1, max: 10 }, options: [] });
    const draft = draftFromQuestion(question);
    expect(toUpdateBody(question, draft).limits).toBeUndefined();
    expect(toUpdateBody(question, { ...draft, max: '20' }).limits).toEqual({ min: 1, max: 20 });
    expect(toUpdateBody(question, { ...draft, min: '' }).limits).toEqual({ max: 10 });
  });
});

describe('lockFlags (D-587, D-593)', () => {
  it('locks nothing for a new question or a question with no answers', () => {
    for (const flags of [lockFlags(null), lockFlags(stored({ answerCount: 0 }))]) {
      expect(flags.typeLocked).toBe(false);
      expect(flags.lockedOptions.size).toBe(0);
      expect(flags.otherLocked).toBe(false);
      expect(flags.limitsWidenOnly).toBe(false);
      expect(flags.visibilityFrozen).toBe(false);
      expect(flags.visibilityRatchet).toBe(false);
    }
  });

  it('locks the type and exactly the options that have answers', () => {
    const flags = lockFlags(stored({ answerCount: 8 }));
    expect(flags.typeLocked).toBe(true);
    expect(flags.answerCount).toBe(8);
    expect([...flags.lockedOptions]).toEqual([[OA.id, 8]]);
  });

  it('locks "Outro" on only when the question allows it and has answers', () => {
    expect(lockFlags(stored({ answerCount: 3, allowOther: true })).otherLocked).toBe(true);
    expect(lockFlags(stored({ answerCount: 3, allowOther: false })).otherLocked).toBe(false);
  });

  it('makes a number or date pair widen-only and no other type', () => {
    const number = adminQuestion('number', { answerCount: 2, options: [] });
    expect(lockFlags(number).limitsWidenOnly).toBe(true);
    expect(lockFlags(adminQuestion('date', { answerCount: 2, options: [] })).limitsWidenOnly).toBe(
      true,
    );
    expect(
      lockFlags(adminQuestion('short_text', { answerCount: 2, options: [] })).limitsWidenOnly,
    ).toBe(false);
  });

  it('freezes a private question and puts a public one on the ratchet (PU-1)', () => {
    expect(lockFlags(stored({ answerCount: 1, showOnProfile: false }))).toMatchObject({
      visibilityFrozen: true,
      visibilityRatchet: false,
    });
    expect(lockFlags(stored({ answerCount: 1, showOnProfile: true }))).toMatchObject({
      visibilityFrozen: false,
      visibilityRatchet: true,
    });
    expect(lockFlags(stored({ answerCount: 0, showOnProfile: true })).visibilityRatchet).toBe(
      false,
    );
  });
});

/**
 * Parity with the server (T-12-36, PFORM-17): the cases below are the ones of
 * `packages/core/tests/profile-form-lock-rules.test.ts` (12-08), the source `checkDraftLocks` mirrors. The UI
 * must refuse exactly what `checkLocks` refuses and nothing else; if that file changes, this one changes.
 */
describe('checkDraftLocks mirrors checkLocks (profile-form-lock-rules.test.ts)', () => {
  const A = { id: 'a0000000-0000-4000-8000-000000000001', label: 'Alfa' };
  const B = { id: 'b0000000-0000-4000-8000-000000000002', label: 'Beta' };
  const C = { id: 'c0000000-0000-4000-8000-000000000003', label: 'Gama' };

  const def = (over: Partial<LockDefinition> = {}): LockDefinition => ({
    type: 'single_choice',
    showOnProfile: false,
    allowOther: false,
    options: [A, B],
    limits: {},
    ...over,
  });
  const check = (
    next: Partial<LockDefinition>,
    over: Partial<Omit<LockInput, 'current' | 'next'>> & { current?: Partial<LockDefinition> } = {},
  ) => {
    const { current, ...rest } = over;
    return checkDraftLocks({
      current: def(current),
      next: def({ ...current, ...next }),
      answerCount: 1,
      answeredOptionIds: new Set<string>(),
      otherAnswered: false,
      ...rest,
    });
  };

  it('with no answers everything is free', () => {
    const changes: Partial<LockDefinition>[] = [
      { type: 'dropdown' },
      { options: [A] },
      { options: [{ ...A, label: 'Outro nome' }, B] },
      { allowOther: false },
      { showOnProfile: true },
      { limits: { min: 5, max: 6 } },
    ];
    for (const next of changes) {
      expect(
        check(next, {
          answerCount: 0,
          answeredOptionIds: new Set([A.id]),
          otherAnswered: true,
          current: { allowOther: true, type: 'number', limits: { min: 1, max: 10 } },
        }),
      ).toBeNull();
    }
  });

  it('type_locked: refused with answers', () => {
    expect(check({ type: 'dropdown' })).toBe('type_locked');
    expect(check({ type: 'single_choice' })).toBeNull();
  });

  it('option_locked: an answered option cannot be removed or renamed; adding and reordering are free', () => {
    const answered = { answeredOptionIds: new Set([A.id]) };
    expect(check({ options: [B] }, answered)).toBe('option_locked');
    expect(check({ options: [{ ...A, label: 'Alfa 2' }, B] }, answered)).toBe('option_locked');
    expect(check({ options: [{ ...A, label: 'alfa' }, B] }, answered)).toBe('option_locked');
    expect(check({ options: [{ ...A, label: 'Alfa ' }, B] }, answered)).toBe('option_locked');
    expect(check({ options: [A] }, answered)).toBeNull();
    expect(check({ options: [A, { ...B, label: 'Beta 2' }] }, answered)).toBeNull();
    expect(check({ options: [A, B, C] }, answered)).toBeNull();
    expect(check({ options: [B, A] }, answered)).toBeNull();
  });

  it('other_locked: off is refused only while an Outro answer exists', () => {
    const current = { allowOther: true };
    expect(check({ allowOther: false }, { current, otherAnswered: true })).toBe('other_locked');
    expect(check({ allowOther: false }, { current, otherAnswered: false })).toBeNull();
    expect(check({ allowOther: true }, { current, otherAnswered: true })).toBeNull();
  });

  it('visibility_locked: private to public is refused, public to private is allowed', () => {
    expect(check({ showOnProfile: true })).toBe('visibility_locked');
    expect(check({ showOnProfile: false }, { current: { showOnProfile: true } })).toBeNull();
    expect(check({ showOnProfile: true }, { current: { showOnProfile: true } })).toBeNull();
  });

  const numberCases: [string, LockDefinition['limits'], LockDefinition['limits'], boolean][] = [
    ['min rises', { min: 1, max: 10 }, { min: 2, max: 10 }, true],
    ['min rises by one step of a decimal', { min: 0.1 }, { min: 0.2 }, true],
    ['max falls', { min: 1, max: 10 }, { min: 1, max: 9 }, true],
    ['a min is set where none existed', {}, { min: 0 }, true],
    ['a max is set where none existed', { min: 1 }, { min: 1, max: 100 }, true],
    ['the limit is equal', { min: 1, max: 10 }, { min: 1, max: 10 }, false],
    ['the limit widens', { min: 1, max: 10 }, { min: 0, max: 11 }, false],
    ['a bound is removed', { min: 1, max: 10 }, { min: 1 }, false],
    ['both bounds are removed', { min: 1, max: 10 }, {}, false],
    ['the min falls by a decimal step', { min: 0.2 }, { min: 0.1 }, false],
  ];
  it.each(numberCases)('limits_locked, number: %s', (_name, from, to, locked) => {
    expect(check({ limits: to }, { current: { type: 'number', options: [], limits: from } })).toBe(
      locked ? 'limits_locked' : null,
    );
  });

  const dateCases: [string, LockDefinition['limits'], LockDefinition['limits'], boolean][] = [
    ['min moves a day later', { min: '2026-01-01' }, { min: '2026-01-02' }, true],
    ['max moves a day earlier', { max: '2026-12-31' }, { max: '2026-12-30' }, true],
    ['a bound is set where none existed', {}, { max: '2026-12-31' }, true],
    [
      'the limit is equal',
      { min: '2026-01-01', max: '2026-12-31' },
      { min: '2026-01-01', max: '2026-12-31' },
      false,
    ],
    ['the limit widens', { min: '2026-01-01' }, { min: '2025-12-31' }, false],
    ['a bound is removed', { min: '2026-01-01' }, {}, false],
  ];
  it.each(dateCases)('limits_locked, date: %s', (_name, from, to, locked) => {
    expect(check({ limits: to }, { current: { type: 'date', options: [], limits: from } })).toBe(
      locked ? 'limits_locked' : null,
    );
  });

  it('limits on a type that has none are not a bound', () => {
    expect(narrowsLimits('short_text', {}, { min: 3 })).toBe(false);
    expect(
      check({ limits: { min: 3 } }, { current: { type: 'short_text', options: [] } }),
    ).toBeNull();
  });

  it('returns the first violated rule: type, option, other, visibility, then limits', () => {
    const current = {
      type: 'number',
      allowOther: true,
      options: [A, B],
      showOnProfile: false,
      limits: { min: 1 },
    };
    const worst: Partial<LockDefinition> = {
      type: 'date',
      options: [],
      allowOther: false,
      showOnProfile: true,
      limits: { min: 5 },
    };
    const facts = { answeredOptionIds: new Set([A.id]), otherAnswered: true, current };
    expect(check(worst, facts)).toBe('type_locked');
    expect(check({ ...worst, type: 'number' }, facts)).toBe('option_locked');
    expect(check({ ...worst, type: 'number', options: [A, B] }, facts)).toBe('other_locked');
    expect(check({ ...worst, type: 'number', options: [A, B], allowOther: true }, facts)).toBe(
      'visibility_locked',
    );
    expect(
      check(
        { ...worst, type: 'number', options: [A, B], allowOther: true, showOnProfile: false },
        facts,
      ),
    ).toBe('limits_locked');
  });
});

describe('the limits refusal before any request (UI-D-574)', () => {
  const question = adminQuestion('number', {
    answerCount: 5,
    limits: { min: 1, max: 10 },
    options: [],
  });

  it('refuses a narrowed pair on a question with answers, and lets a widened one through', () => {
    const draft = draftFromQuestion(question);
    expect(validateDraft({ ...draft, max: '9' }, question).limits).toEqual({
      key: 'locked.limitsRefused',
    });
    expect(validateDraft({ ...draft, min: '2' }, question).limits).toEqual({
      key: 'locked.limitsRefused',
    });
    expect(hasErrors(validateDraft({ ...draft, min: '0', max: '11' }, question))).toBe(false);
    expect(hasErrors(validateDraft({ ...draft, min: '', max: '' }, question))).toBe(false);
    expect(draftLock(question, { ...draft, max: '9' })).toBe('limits_locked');
  });

  it('does not refuse the same narrowing on a question nobody answered', () => {
    const fresh = { ...question, answerCount: 0 };
    expect(hasErrors(validateDraft({ ...draftFromQuestion(fresh), max: '9' }, fresh))).toBe(false);
  });
});
