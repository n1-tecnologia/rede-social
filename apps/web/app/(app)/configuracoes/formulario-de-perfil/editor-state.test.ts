import { describe, expect, it } from 'vitest';
import {
  blankDraft,
  canSave,
  changeType,
  hasErrors,
  isDirty,
  parseLimits,
  serverFieldError,
  toCreateBody,
  validateDraft,
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
