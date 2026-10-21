import { describe, expect, it } from 'vitest';
import { PAYMENTS_PUSH_BODY_MAX, paymentsPushCopy } from '../server/notification-copy';

/**
 * 09.1-12 (PAY-24, D-506; interaction truth E13 overflow): the push body of the buyer's "Compra
 * confirmada" notice. Built server-side (a push exists before any page loads), cut on a word to at most
 * 100 graphemes with an ellipsis only when it cut. No database.
 */

const graphemes = (text: string): number =>
  Array.from(new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(text)).length;

describe('paymentsPushCopy.purchaseConfirmed', () => {
  it('caps a banner at 100 graphemes', () => {
    expect(PAYMENTS_PUSH_BODY_MAX).toBe(100);
  });

  it('is "Compra confirmada: {name}" for a short name, never cut and never given an ellipsis', () => {
    expect(paymentsPushCopy.purchaseConfirmed('Curso A')).toBe('Compra confirmada: Curso A');
    expect(paymentsPushCopy.purchaseConfirmed('Curso A')).not.toContain('…');
  });

  it('cuts a 120-character name on a word to at most 100 graphemes with a trailing ellipsis', () => {
    const name = Array.from({ length: 15 }, (_, i) => `palavra${i}`)
      .join(' ')
      .slice(0, 120)
      .padEnd(120, 'x');
    expect(name).toHaveLength(120);
    const body = paymentsPushCopy.purchaseConfirmed(name);
    expect(graphemes(body)).toBeLessThanOrEqual(PAYMENTS_PUSH_BODY_MAX);
    expect(body.endsWith('…')).toBe(true);
    expect(body.startsWith('Compra confirmada: palavra0 palavra1')).toBe(true);
    // cut on a word: nothing but whole words precedes the ellipsis
    const kept = body.slice('Compra confirmada: '.length, -1).trimEnd();
    expect(name.startsWith(kept)).toBe(true);
    expect(name.charAt(kept.length)).toBe(' ');
  });

  it('counts an emoji and an accented name in graphemes, not bytes or code units', () => {
    const name = Array.from({ length: 30 }, () => 'Formação 🎓👩🏽‍💻').join(' ');
    const body = paymentsPushCopy.purchaseConfirmed(name);
    expect(graphemes(body)).toBeLessThanOrEqual(PAYMENTS_PUSH_BODY_MAX);
    expect(body.endsWith('…')).toBe(true);
    // a family emoji is one grapheme: the body is never cut through one
    expect(body).not.toMatch(/‍…$/);
  });

  it('does not cut a body of exactly 100 graphemes', () => {
    const name = 'a'.repeat(PAYMENTS_PUSH_BODY_MAX - 'Compra confirmada: '.length);
    const body = paymentsPushCopy.purchaseConfirmed(name);
    expect(graphemes(body)).toBe(PAYMENTS_PUSH_BODY_MAX);
    expect(body).toBe(`Compra confirmada: ${name}`);
    expect(body).not.toContain('…');
  });

  it('cuts a body of 101 graphemes', () => {
    const name = 'a '.repeat(60).trim();
    const body = paymentsPushCopy.purchaseConfirmed(name);
    expect(graphemes(body)).toBeLessThanOrEqual(PAYMENTS_PUSH_BODY_MAX);
    expect(body.endsWith('…')).toBe(true);
  });
});
