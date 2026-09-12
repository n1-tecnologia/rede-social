import { describe, expect, it } from 'vitest';
import { readLegalDoc, TRIA_PRIVACY_VERSION, TRIA_TERMS_VERSION } from '../src/legal';

/**
 * The constants are what `consent_records.text_version` stores; the markdown is what the person read.
 * These assertions are the mechanism that keeps LGPD evidence honest: editing a legal text without
 * bumping the constants (or vice versa) fails CI.
 */
describe('legal texts and versions stay in sync', () => {
  it('termos-de-uso front-matter version equals TRIA_TERMS_VERSION', () => {
    const doc = readLegalDoc('termos-de-uso');
    expect(doc.version).toBe(TRIA_TERMS_VERSION);
    expect(doc.body).toContain('# Termos de Uso');
  });

  it('politica-de-privacidade front-matter version equals TRIA_PRIVACY_VERSION', () => {
    const doc = readLegalDoc('politica-de-privacidade');
    expect(doc.version).toBe(TRIA_PRIVACY_VERSION);
    expect(doc.body).toContain('# Política de Privacidade');
  });

  // One consent, one version (D-03): the single `tria_terms` row records ONE number for BOTH texts.
  it('TRIA_PRIVACY_VERSION === TRIA_TERMS_VERSION', () => {
    expect(TRIA_PRIVACY_VERSION).toBe(TRIA_TERMS_VERSION);
  });

  it('an unknown document name throws instead of returning an unversioned body', () => {
    // @ts-expect-error — the point of the test is the runtime guard for a name outside the union.
    expect(() => readLegalDoc('inexistente')).toThrow();
  });
});
