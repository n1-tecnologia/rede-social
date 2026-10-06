import { describe, expect, it } from 'vitest';
import {
  JOIN_STATES,
  joinBodySchema,
  joinFormSchema,
  joinResponseSchema,
  joinStateSchema,
} from '../src/join';

/** 08.1-01: the join contract (D-305, D-306, D-311). */
const body = {
  name: '  Ana Souza  ',
  consents: { tenantRulesVersion: 1, platformTermsVersion: 1 },
};

describe('join contract', () => {
  it('1. the name is trimmed and must be 2..120 characters', () => {
    expect(joinBodySchema.parse(body).name).toBe('Ana Souza');
    expect(joinBodySchema.safeParse({ ...body, name: ' A ' }).success).toBe(false);
    expect(joinBodySchema.safeParse({ ...body, name: 'x'.repeat(121) }).success).toBe(false);
    expect(joinBodySchema.safeParse({ ...body, name: 'x'.repeat(120) }).success).toBe(true);
  });

  it('2. both consent versions are positive integers', () => {
    for (const bad of [0, -1, 1.5, '1']) {
      expect(
        joinBodySchema.safeParse({
          ...body,
          consents: { tenantRulesVersion: bad, platformTermsVersion: 1 },
        }).success,
      ).toBe(false);
      expect(
        joinBodySchema.safeParse({
          ...body,
          consents: { tenantRulesVersion: 1, platformTermsVersion: bad },
        }).success,
      ).toBe(false);
    }
  });

  it('3. slug is optional and, when present, a slug', () => {
    expect(joinBodySchema.parse(body).slug).toBeUndefined();
    expect(joinBodySchema.parse({ ...body, slug: 'rede-lab' }).slug).toBe('rede-lab');
    expect(joinBodySchema.safeParse({ ...body, slug: 'Rede-Lab' }).success).toBe(false);
  });

  it('4. the state schema answers one of the seven states and rejects extra keys', () => {
    for (const state of JOIN_STATES) expect(joinStateSchema.parse({ state })).toEqual({ state });
    expect(JOIN_STATES).toHaveLength(7);
    expect(joinStateSchema.safeParse({ state: 'other' }).success).toBe(false);
    expect(joinStateSchema.safeParse({ state: 'member', tenant: 'rede-demo' }).success).toBe(false);
  });

  it('5. the form needs both boxes explicitly ticked and carries no slug', () => {
    const form = { ...body, acceptRules: true, acceptTerms: true };
    expect(joinFormSchema.safeParse(form).success).toBe(true);
    expect(joinFormSchema.safeParse({ ...form, acceptRules: false }).success).toBe(false);
    expect(joinFormSchema.safeParse({ ...form, acceptTerms: undefined }).success).toBe(false);
    expect('slug' in joinFormSchema.shape).toBe(false);
  });

  it('6. the response is joined or already_member with the tenant slug', () => {
    expect(joinResponseSchema.parse({ outcome: 'joined', tenantSlug: 'rede-lab' }).outcome).toBe(
      'joined',
    );
    expect(
      joinResponseSchema.safeParse({ outcome: 'created', tenantSlug: 'rede-lab' }).success,
    ).toBe(false);
  });
});
