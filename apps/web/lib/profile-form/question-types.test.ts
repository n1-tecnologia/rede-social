import { PROFILE_FORM_TYPES } from '@rede-social/contracts/profile-form';
import { describe, expect, it } from 'vitest';
import {
  isChoiceType,
  isRangeType,
  orderedTypes,
  QUESTION_TYPE_META,
  typeHintKey,
  typeName,
  typeNameKey,
} from './question-types';

/**
 * 12-16 Task 1 (D-590, D-591, UI-D-570): the one table of the fourteen types. A new type in the contract
 * must be a row here (and so a tile), which the record type enforces at compile time and these tests at run
 * time.
 */
describe('QUESTION_TYPE_META', () => {
  it('has exactly the keys of PROFILE_FORM_TYPES', () => {
    expect(Object.keys(QUESTION_TYPE_META).sort()).toEqual([...PROFILE_FORM_TYPES].sort());
    expect(Object.keys(QUESTION_TYPE_META)).toHaveLength(14);
  });

  it('numbers the tiles 1 to 14 with no repeat', () => {
    const orders = Object.values(QUESTION_TYPE_META).map((meta) => meta.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
  });

  it('gives every type a glyph', () => {
    for (const type of PROFILE_FORM_TYPES) {
      expect(QUESTION_TYPE_META[type].glyph, type).toBeDefined();
    }
  });
});

describe('orderedTypes', () => {
  it('lists the tiles in the order of the Copywriting Contract', () => {
    expect(orderedTypes()).toEqual([
      'short_text',
      'long_text',
      'dropdown',
      'multiple_choice',
      'single_choice',
      'yes_no',
      'acceptance',
      'number',
      'rating',
      'date',
      'phone',
      'email',
      'link',
      'professional_id',
    ]);
    expect(QUESTION_TYPE_META.professional_id.order).toBe(14);
  });
});

describe('names and hints', () => {
  it('reads the catalog keys of the type', () => {
    expect(typeNameKey('multiple_choice')).toBe('types.multiChoice.name');
    expect(typeHintKey('yes_no')).toBe('types.yesNo.hint');
    expect(typeName((key) => `<${key}>`, 'rating')).toBe('<types.rating.name>');
  });
});

describe('type families', () => {
  it('knows the three choice types and the two range types', () => {
    expect(PROFILE_FORM_TYPES.filter((type) => isChoiceType(type))).toEqual([
      'dropdown',
      'multiple_choice',
      'single_choice',
    ]);
    expect(PROFILE_FORM_TYPES.filter((type) => isRangeType(type))).toEqual(['number', 'date']);
    expect(isChoiceType(null)).toBe(false);
    expect(isRangeType(null)).toBe(false);
  });
});
