import { describe, expect, it } from 'vitest';
import {
  decodePendingConfirmation,
  encodePendingConfirmation,
  isEmailNotConfirmed,
  PENDING_CONFIRMATION_COOKIE,
  PENDING_CONFIRMATION_MAX_AGE_S,
  RESEND_COOLDOWN_MS,
  withinResendCooldown,
} from './pending-confirmation';

/**
 * The "verifique seu e-mail" cookie codec, the resend cooldown and the unconfirmed-login predicate
 * (quick 261007-gbk, T-gbk-01, T-gbk-06): the codec round-trips `{ email, sentAt? }` and refuses
 * everything else, in particular a value that carries a password.
 */

function encodeRaw(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

describe('pending confirmation codec', () => {
  it('names the cookie, keeps it for one hour and mirrors the 60 s production resend floor', () => {
    expect(PENDING_CONFIRMATION_COOKIE).toBe('pending_confirmation');
    expect(PENDING_CONFIRMATION_MAX_AGE_S).toBe(3600);
    expect(RESEND_COOLDOWN_MS).toBe(60_000);
  });

  it('round-trips an e-mail alone and an e-mail with sentAt', () => {
    const bare = { email: 'pessoa@exemplo.com.br' };
    const raw = encodePendingConfirmation(bare);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodePendingConfirmation(raw)).toEqual(bare);

    const stamped = { email: 'pessoa@exemplo.com.br', sentAt: 1_700_000_000_000 };
    expect(decodePendingConfirmation(encodePendingConfirmation(stamped))).toEqual(stamped);
  });

  it('never encodes anything beyond the two fields', () => {
    const raw = encodePendingConfirmation({
      email: 'pessoa@exemplo.com.br',
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
    ['a JSON array', encodeRaw(['pessoa@exemplo.com.br'])],
    ['a JSON string', encodeRaw('pessoa@exemplo.com.br')],
    ['a missing e-mail', encodeRaw({ sentAt: 1 })],
    ['an invalid e-mail', encodeRaw({ email: 'not-an-email' })],
    ['a negative sentAt', encodeRaw({ email: 'pessoa@exemplo.com.br', sentAt: -1 })],
    ['a fractional sentAt', encodeRaw({ email: 'pessoa@exemplo.com.br', sentAt: 1.5 })],
    ['a string sentAt', encodeRaw({ email: 'pessoa@exemplo.com.br', sentAt: '1' })],
    ['an over-long value', 'A'.repeat(4096)],
  ])('decodes %s to null', (_label, raw) => {
    expect(decodePendingConfirmation(raw as string | null | undefined)).toBeNull();
  });

  it('refuses a value that carries a password (strict shape)', () => {
    const raw = encodeRaw({ email: 'pessoa@exemplo.com.br', password: 'Segredo123' });
    expect(decodePendingConfirmation(raw)).toBeNull();
  });

  it('refuses any other extra key', () => {
    const raw = encodeRaw({ email: 'pessoa@exemplo.com.br', sentAt: 1, name: 'Ana' });
    expect(decodePendingConfirmation(raw)).toBeNull();
  });
});

describe('withinResendCooldown', () => {
  const email = 'pessoa@exemplo.com.br';
  const now = 1_700_000_000_000;

  it('is true only while less than 60 s have passed since sentAt', () => {
    expect(withinResendCooldown({ email, sentAt: now - 1 }, now)).toBe(true);
    expect(withinResendCooldown({ email, sentAt: now - 59_999 }, now)).toBe(true);
  });

  it('is false without sentAt, at exactly 60 s and long after', () => {
    expect(withinResendCooldown({ email }, now)).toBe(false);
    expect(withinResendCooldown({ email, sentAt: now - 60_000 }, now)).toBe(false);
    expect(withinResendCooldown({ email, sentAt: 1 }, now)).toBe(false);
  });

  it('treats a sentAt in the future as within the cooldown (clock skew never opens the gate)', () => {
    expect(withinResendCooldown({ email, sentAt: now + 5_000 }, now)).toBe(true);
  });
});

describe('isEmailNotConfirmed', () => {
  it('is true for the GoTrue code and for the message in any case', () => {
    expect(isEmailNotConfirmed({ code: 'email_not_confirmed' })).toBe(true);
    expect(isEmailNotConfirmed({ message: 'Email not confirmed' })).toBe(true);
    expect(isEmailNotConfirmed({ message: 'EMAIL NOT CONFIRMED' })).toBe(true);
    expect(isEmailNotConfirmed({ code: 'x', message: 'email not confirmed' })).toBe(true);
  });

  it('is false for invalid credentials, other codes, empty and missing errors', () => {
    expect(
      isEmailNotConfirmed({ code: 'invalid_credentials', message: 'Invalid login credentials' }),
    ).toBe(false);
    expect(isEmailNotConfirmed({ code: 'over_request_rate_limit' })).toBe(false);
    expect(isEmailNotConfirmed({})).toBe(false);
    expect(isEmailNotConfirmed({ code: '', message: '' })).toBe(false);
    expect(isEmailNotConfirmed(undefined)).toBe(false);
    expect(isEmailNotConfirmed(null)).toBe(false);
  });
});
