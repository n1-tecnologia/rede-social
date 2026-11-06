import { PROFILE_FORM_LIMITS } from '@rede-social/contracts/profile-form';
import { describe, expect, it } from 'vitest';
import {
  branchChainOpenSql,
  questionVisibleSql,
  VISIBILITY_SQL_DEPTH,
} from '../server/profile-form/visibility-sql';

/**
 * 12.2-04 (D-644, T-12.2-11): the ONE SQL fragment of "every branch on the chain is open for this member". The
 * builders compose caller-controlled identifiers into raw SQL text, so the identifier validation, the level
 * count (the drift guard against `PROFILE_FORM_LIMITS.branchDepth`) and the absence of an archive predicate are
 * all proved here. The behaviour against a database is plan 11's integration drift test.
 */

const args = { branchRef: 'q.branch_id', tenant: 'q.tenant_id', member: 'm.id' };

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe('12.2-04 branchChainOpenSql: shape (D-644)', () => {
  const sql = branchChainOpenSql(args);

  it('has exactly PROFILE_FORM_LIMITS.branchDepth branch levels and the constant is the depth', () => {
    expect(VISIBILITY_SQL_DEPTH).toBe(PROFILE_FORM_LIMITS.branchDepth);
    expect(count(sql, 'public.profile_form_branches')).toBe(PROFILE_FORM_LIMITS.branchDepth);
  });

  it('reads the member answer through the token function once per level', () => {
    expect(count(sql, 'app.profile_form_answer_tokens')).toBe(PROFILE_FORM_LIMITS.branchDepth);
    expect(count(sql, 'public.profile_form_answers')).toBe(PROFILE_FORM_LIMITS.branchDepth);
    expect(sql).toContain('open_values &&');
  });

  it('has no predicate on the archive of a branch or a question (an archived block keeps its answers)', () => {
    expect(sql).not.toContain('archived_at');
  });

  it('does not recurse and never limits', () => {
    expect(sql.toLowerCase()).not.toContain('recursive');
    expect(sql.toLowerCase()).not.toContain('limit');
  });

  it('is one balanced boolean expression over the caller identifiers', () => {
    expect(count(sql, '(')).toBe(count(sql, ')'));
    expect(sql.trimStart().startsWith('exists (')).toBe(true);
    expect(sql).toContain('= q.branch_id');
    expect(sql).toContain('= q.tenant_id');
    expect(sql).toContain('= m.id');
  });

  it('ands every level: a level that is absent from the chain counts as open', () => {
    expect(count(sql, 'is null or')).toBe(PROFILE_FORM_LIMITS.branchDepth - 1);
  });
});

describe('12.2-04 questionVisibleSql: a question with no branch is always visible', () => {
  it('wraps the chain with the null-branch short cut', () => {
    const sql = questionVisibleSql({ question: 'q', tenant: 'q.tenant_id', member: 'm.id' });
    expect(sql.startsWith('(q.branch_id is null or ')).toBe(true);
    expect(sql.endsWith(')')).toBe(true);
    expect(sql).toContain(branchChainOpenSql(args));
  });
});

describe('12.2-04 identifier validation (T-12.2-11): a quote or a space throws', () => {
  it.each([
    ['a quote', "q.branch_id'"],
    ['a space', 'q.branch_id or true'],
    ['a semicolon', 'q.branch_id;drop'],
    ['a double quote', '"q"."id"'],
    ['a comment', 'q.id--'],
    ['an empty string', ''],
    ['an uppercase letter', 'Q.id'],
    ['a leading digit', '1q.id'],
    ['a placeholder', '$1'],
    ['a cast', 'q.id::text'],
  ])('refuses %s in any of the three identifiers', (_name, bad) => {
    expect(() => branchChainOpenSql({ ...args, branchRef: bad })).toThrow();
    expect(() => branchChainOpenSql({ ...args, tenant: bad })).toThrow();
    expect(() => branchChainOpenSql({ ...args, member: bad })).toThrow();
    expect(() =>
      questionVisibleSql({ question: bad, tenant: 'q.tenant_id', member: 'm.id' }),
    ).toThrow();
    expect(() => questionVisibleSql({ question: 'q', tenant: bad, member: 'm.id' })).toThrow();
    expect(() =>
      questionVisibleSql({ question: 'q', tenant: 'q.tenant_id', member: bad }),
    ).toThrow();
  });

  it('accepts a plain alias, a dotted column and an underscore name', () => {
    expect(() =>
      branchChainOpenSql({ branchRef: 'r.branch_id', tenant: 'r.tenant_id', member: 'm.id' }),
    ).not.toThrow();
    expect(() =>
      questionVisibleSql({ question: 'req', tenant: 'req.tenant_id', member: 'members_x.id' }),
    ).not.toThrow();
  });
});
