import { describe, expect, it } from 'vitest';
import {
  CHAT_CASE_CATEGORIES,
  CHAT_CASE_PRIORITIES,
  CHAT_PERMISSIONS,
  CHAT_SUBJECT_MAX,
  codePointLength,
  subjectInputSchema,
  supportSendInputSchema,
} from '../contracts/index';

/**
 * The case contract surface of Phase 12.4, pinned without a server (CASE-24). The tracer block proves the
 * first path through the plan: the member's first message may carry a category and a subject and never a
 * priority, a state or an owner (D-811, D-812, T-12.4-21).
 */

const issuesOf = (schema: { safeParse: (v: unknown) => unknown }, value: unknown): string[] => {
  const parsed = schema.safeParse(value) as {
    success: boolean;
    error?: { issues: { message: string }[] };
  };
  return parsed.success ? [] : (parsed.error?.issues.map((issue) => issue.message) ?? []);
};

describe('case tracer', () => {
  it('names the assign permission beside the two shipped ones', () => {
    expect(CHAT_PERMISSIONS.assign).toBe('chat.support.assign');
    expect(CHAT_CASE_CATEGORIES).toEqual(['check_in', 'events', 'payment', 'account', 'other']);
    expect(CHAT_CASE_PRIORITIES).toEqual(['low', 'normal', 'high']);
    expect(CHAT_SUBJECT_MAX).toBe(80);
  });

  it('accepts a first message with a category and a subject, and a body alone', () => {
    const full = supportSendInputSchema.parse({
      body: 'Preciso de ajuda',
      category: 'payment',
      subject: 'Cobrança duplicada',
    });
    expect(full).toEqual({
      body: 'Preciso de ajuda',
      category: 'payment',
      subject: 'Cobrança duplicada',
    });
    expect(supportSendInputSchema.parse({ body: 'oi' })).toEqual({ body: 'oi' });
  });

  it('an all-whitespace subject becomes an absent subject', () => {
    const parsed = supportSendInputSchema.parse({ body: 'oi', subject: '   \n ' });
    expect(parsed.subject).toBeUndefined();
    expect(subjectInputSchema.parse('')).toBeUndefined();
  });

  it('refuses a forged priority, state or owner as a plain failure, never an issue code', () => {
    expect(supportSendInputSchema.safeParse({ body: 'oi', priority: 'high' }).success).toBe(false);
    expect(supportSendInputSchema.safeParse({ body: 'oi', state: 'closed' }).success).toBe(false);
    expect(supportSendInputSchema.safeParse({ body: 'oi', ownerUserId: 'x' }).success).toBe(false);
    expect(supportSendInputSchema.safeParse({ body: 'oi', category: 'nope' }).success).toBe(false);
    expect(issuesOf(supportSendInputSchema, { body: 'oi', priority: 'high' })).not.toContain(
      'subject_too_long',
    );
  });

  it('counts the subject in code points: 80 emoji pass, 81 are subject_too_long', () => {
    const emoji = '😀'.repeat(CHAT_SUBJECT_MAX);
    expect(codePointLength(emoji)).toBe(80);
    expect(supportSendInputSchema.safeParse({ body: 'oi', subject: emoji }).success).toBe(true);
    expect(issuesOf(supportSendInputSchema, { body: 'oi', subject: `${emoji}😀` })).toEqual([
      'subject_too_long',
    ]);
  });
});
