import { describe, expect, it } from 'vitest';
import {
  decodeJoinDraft,
  encodeJoinDraft,
  JOIN_DRAFT_COOKIE,
  JOIN_DRAFT_MAX_AGE_S,
} from './join-draft';

/**
 * The "já tem conta" draft codec (08.1, D-301, T-08.1-13, T-08.1-17): it round-trips `{ email, name }`
 * and refuses everything else — in particular a value that carries a password.
 */

function encodeRaw(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

describe('join draft codec', () => {
  it('names the cookie and keeps it for ten minutes', () => {
    expect(JOIN_DRAFT_COOKIE).toBe('join_draft');
    expect(JOIN_DRAFT_MAX_AGE_S).toBe(600);
  });

  it('round-trips an e-mail and a name (accents included)', () => {
    const draft = { email: 'pessoa@exemplo.com.br', name: 'Ana Conceição' };
    const raw = encodeJoinDraft(draft);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeJoinDraft(raw)).toEqual(draft);
  });

  it('never encodes anything beyond the two fields', () => {
    const raw = encodeJoinDraft({
      email: 'pessoa@exemplo.com.br',
      name: 'Ana',
      password: 'Segredo123',
    } as never);
    expect(Buffer.from(raw, 'base64url').toString('utf8')).not.toContain('Segredo123');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty', ''],
    ['garbage', '%%%not-base64%%%'],
    ['non-JSON base64url', Buffer.from('not json', 'utf8').toString('base64url')],
    ['a JSON array', encodeRaw(['pessoa@exemplo.com.br', 'Ana'])],
    ['a JSON string', encodeRaw('pessoa@exemplo.com.br')],
    ['a missing name', encodeRaw({ email: 'pessoa@exemplo.com.br' })],
    ['a one-letter name', encodeRaw({ email: 'pessoa@exemplo.com.br', name: 'A' })],
    ['an invalid e-mail', encodeRaw({ email: 'not-an-email', name: 'Ana' })],
    ['an over-long value', 'A'.repeat(4096)],
  ])('decodes %s to null', (_label, raw) => {
    expect(decodeJoinDraft(raw as string | null | undefined)).toBeNull();
  });

  it('refuses a draft that carries a password (strict shape)', () => {
    const raw = encodeRaw({ email: 'pessoa@exemplo.com.br', name: 'Ana', password: 'Segredo123' });
    expect(decodeJoinDraft(raw)).toBeNull();
  });

  it('refuses any other extra key', () => {
    const raw = encodeRaw({ email: 'pessoa@exemplo.com.br', name: 'Ana', tenant: 'outra' });
    expect(decodeJoinDraft(raw)).toBeNull();
  });
});
