import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LESSON_LOCK_REASONS,
  lessonLockLabel,
  MODULE_LOCK_REASONS,
  moduleLockLabel,
  padNumber,
} from '../contracts';

/**
 * 08.5-07 — the lock-label formatter (UI-D-430, R-Pattern 3, E07 labels-only truth). It labels the
 * server's `lockReason` and decides nothing: each reason maps to ONE catalog key, the module number
 * is two digits, and the source reads no clock and no storage.
 */

describe('padNumber', () => {
  it.each([
    [1, '01'],
    [9, '09'],
    [10, '10'],
    [123, '123'],
    [0, '01'],
    [Number.NaN, '01'],
  ])('%s → %s', (input, output) => {
    expect(padNumber(input)).toBe(output);
  });
});

describe('lessonLockLabel (UI-D-430)', () => {
  it('open (null) → no label', () => {
    expect(lessonLockLabel({ lockReason: null, previousModuleNumber: 1 })).toBeNull();
  });

  it('purchase → "{duration} · Aula exclusiva" with the formatted length', () => {
    expect(lessonLockLabel({ lockReason: 'purchase', duration: '12:34' })).toEqual({
      key: 'courses.member.lesson.exclusive',
      values: { duration: '12:34' },
    });
    expect(lessonLockLabel({ lockReason: 'purchase' })).toEqual({
      key: 'courses.member.lesson.exclusive',
      values: { duration: '' },
    });
  });

  it('lesson rule → "Libera ao concluir a aula anterior" (no values)', () => {
    expect(lessonLockLabel({ lockReason: 'lesson', previousModuleNumber: 3 })).toEqual({
      key: 'courses.member.lesson.lockedByPrevious',
      values: {},
    });
  });

  it('module rule → "Libera ao concluir o Módulo {nn}" with the PREVIOUS module, two digits', () => {
    expect(lessonLockLabel({ lockReason: 'module', previousModuleNumber: 1 })).toEqual({
      key: 'courses.member.lesson.lockedByModule',
      values: { nn: '01' },
    });
    expect(lessonLockLabel({ lockReason: 'module', previousModuleNumber: 12 })?.values).toEqual({
      nn: '12',
    });
  });

  it('every server reason has a label (the switch is exhaustive)', () => {
    for (const reason of LESSON_LOCK_REASONS) {
      expect(lessonLockLabel({ lockReason: reason, previousModuleNumber: 1 })).not.toBeNull();
    }
  });
});

describe('moduleLockLabel (UI-D-429)', () => {
  it('only the module rule replaces the band meta', () => {
    expect(moduleLockLabel({ lockReason: 'module', previousModuleNumber: 2 })).toEqual({
      key: 'courses.member.module.lockedBy',
      values: { nn: '02' },
    });
    expect(moduleLockLabel({ lockReason: 'purchase', previousModuleNumber: 2 })).toBeNull();
    expect(moduleLockLabel({ lockReason: null, previousModuleNumber: 2 })).toBeNull();
    expect(MODULE_LOCK_REASONS).toEqual(['purchase', 'module']);
  });
});

describe('purity (R-Pattern 3)', () => {
  it('the formatter source reads no clock and no storage', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../contracts/lock.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/Date|localStorage|sessionStorage|fetch\(/);
  });
});
