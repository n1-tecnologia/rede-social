import { join } from 'node:path';
import { PROFILE_FORM_TYPES } from '@rede-social/contracts/profile-form';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { PROFILE_FORM_TYPE_KEYS, typeNameKey } from './type-key';

/** 12-15 — every question type has a catalog name (D-591): a new type is a compile error and a test failure. */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
const t = createTranslator({ locale: 'pt-BR', messages, namespace: 'profileForm' }) as unknown as (
  key: string,
) => string;

describe('typeNameKey', () => {
  it('covers exactly the 13 contract types', () => {
    expect(Object.keys(PROFILE_FORM_TYPE_KEYS).sort()).toEqual([...PROFILE_FORM_TYPES].sort());
  });

  it('resolves every type to a real, non-empty catalog name', () => {
    for (const type of PROFILE_FORM_TYPES) {
      const name = t(typeNameKey(type));
      expect(name, type).not.toBe('');
      expect(name, type).not.toContain('profileForm');
    }
  });
});
