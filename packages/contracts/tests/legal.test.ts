import { describe, expect, it } from 'vitest';
import {
  adminRulesSchema,
  normaliseRulesText,
  PLATFORM_PRIVACY_VERSION,
  PLATFORM_TERMS_VERSION,
  RULES_TEXT_MAX,
  readLegalDoc,
  rulesBodySchema,
} from '../src/legal';

/**
 * The constants are what `consent_records.text_version` stores; the markdown is what the person read.
 * These assertions are the mechanism that keeps LGPD evidence honest: editing a legal text without
 * bumping the constants (or vice versa) fails CI.
 */
describe('legal texts and versions stay in sync', () => {
  it('termos-de-uso front-matter version equals PLATFORM_TERMS_VERSION', () => {
    const doc = readLegalDoc('termos-de-uso');
    expect(doc.version).toBe(PLATFORM_TERMS_VERSION);
    expect(doc.body).toContain('# Termos de Uso');
  });

  it('politica-de-privacidade front-matter version equals PLATFORM_PRIVACY_VERSION', () => {
    const doc = readLegalDoc('politica-de-privacidade');
    expect(doc.version).toBe(PLATFORM_PRIVACY_VERSION);
    expect(doc.body).toContain('# Política de Privacidade');
  });

  // One consent, one version (D-03): the single `platform_terms` row records ONE number for BOTH texts.
  it('PLATFORM_PRIVACY_VERSION === PLATFORM_TERMS_VERSION', () => {
    expect(PLATFORM_PRIVACY_VERSION).toBe(PLATFORM_TERMS_VERSION);
  });

  it('an unknown document name throws instead of returning an unversioned body', () => {
    // @ts-expect-error — the point of the test is the runtime guard for a name outside the union.
    expect(() => readLegalDoc('inexistente')).toThrow();
  });
});

/**
 * ADMIN-03 (08-07): the tenant rules body. The checks run on the NORMALISED value — the value the
 * API compares and stores — so a Windows paste of identical text is identical, whitespace is not
 * text, and the cap is counted in UTF-16 code units (the field's `maxLength` unit).
 */
describe('tenant rules contract (ADMIN-03)', () => {
  const issueOf = (input: unknown): string | undefined => {
    const parsed = rulesBodySchema.safeParse({ rulesText: input });
    return parsed.success ? undefined : parsed.error.issues[0]?.message;
  };

  it('normaliseRulesText turns CRLF and lone CR into LF and trims', () => {
    expect(normaliseRulesText('  Um\r\nDois\rTres\n\n  ')).toBe('Um\nDois\nTres');
    expect(normaliseRulesText('A\r\n\r\nB')).toBe('A\n\nB');
  });

  it('CRLF parity: a Windows paste parses to the same text as the LF original', () => {
    const lf = rulesBodySchema.parse({ rulesText: 'Regra 1\nRegra 2\n\nParágrafo 2' });
    const crlf = rulesBodySchema.parse({ rulesText: 'Regra 1\r\nRegra 2\r\n\r\nParágrafo 2\r\n' });
    expect(crlf.rulesText).toBe(lf.rulesText);
  });

  it('trims leading and trailing whitespace before storing', () => {
    expect(rulesBodySchema.parse({ rulesText: '\n\n  Seja gentil.  \n' }).rulesText).toBe(
      'Seja gentil.',
    );
  });

  it('refuses empty and whitespace-only text as required', () => {
    expect(issueOf('')).toBe('required');
    expect(issueOf('   \r\n\t  \n')).toBe('required');
  });

  it(`accepts exactly ${RULES_TEXT_MAX} code units and refuses ${RULES_TEXT_MAX + 1}`, () => {
    expect(issueOf('a'.repeat(RULES_TEXT_MAX))).toBeUndefined();
    expect(issueOf('a'.repeat(RULES_TEXT_MAX + 1))).toBe('too_long');
  });

  it('counts an emoji as two code units at the cap', () => {
    // 9,998 + one emoji (2 code units) = 10,000: accepted. 9,999 + one emoji = 10,001: refused.
    expect(issueOf(`${'a'.repeat(RULES_TEXT_MAX - 2)}🎉`)).toBeUndefined();
    expect(issueOf(`${'a'.repeat(RULES_TEXT_MAX - 1)}🎉`)).toBe('too_long');
  });

  it('measures the cap after normalisation (surrounding whitespace does not count)', () => {
    expect(issueOf(`  ${'a'.repeat(RULES_TEXT_MAX)}\r\n`)).toBeUndefined();
  });

  it('is strict: no other key rides along', () => {
    expect(rulesBodySchema.safeParse({ rulesText: 'Ok', rulesVersion: 9 }).success).toBe(false);
    expect(rulesBodySchema.safeParse({ rulesText: 'Ok', tenantId: 'x' }).success).toBe(false);
  });

  it('adminRulesSchema is { rulesText, rulesVersion } and strict', () => {
    expect(adminRulesSchema.parse({ rulesText: 'A', rulesVersion: 2 })).toEqual({
      rulesText: 'A',
      rulesVersion: 2,
    });
    expect(adminRulesSchema.safeParse({ rulesText: 'A', rulesVersion: 0 }).success).toBe(false);
    expect(
      adminRulesSchema.safeParse({ rulesText: 'A', rulesVersion: 1, extra: true }).success,
    ).toBe(false);
  });
});
