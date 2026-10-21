import { describe, expect, it } from 'vitest';
import { PAYMENTS_TABS, paymentsTabFromParam, paymentsTabHref } from './tabs';

/**
 * 09.1-13 — the Pagamentos tab registry (UI-D-513, E01 error). Configuração is the entry: no value,
 * an empty one, an unknown one and a repeated one all read as it, and its href is the bare path.
 */

describe('PAYMENTS_TABS (UI-D-513)', () => {
  it('lists Configuração, Acessos, Eventos in that order', () => {
    expect(PAYMENTS_TABS).toEqual(['setup', 'access', 'events']);
  });
});

describe('paymentsTabFromParam (E01 error)', () => {
  it('reads no value, an empty value, an unknown value and a repeated one as the setup tab', () => {
    expect(paymentsTabFromParam(undefined)).toBe('setup');
    expect(paymentsTabFromParam('')).toBe('setup');
    expect(paymentsTabFromParam('foo')).toBe('setup');
    expect(paymentsTabFromParam(['acessos', 'eventos'])).toBe('setup');
    expect(paymentsTabFromParam(['eventos'])).toBe('setup');
  });

  it('is exact: case, padding and the English keys do not select a tab', () => {
    expect(paymentsTabFromParam('ACESSOS')).toBe('setup');
    expect(paymentsTabFromParam(' eventos')).toBe('setup');
    expect(paymentsTabFromParam('access')).toBe('setup');
    expect(paymentsTabFromParam('events')).toBe('setup');
  });

  it('answers the access and events tabs for their own pt-BR values', () => {
    expect(paymentsTabFromParam('acessos')).toBe('access');
    expect(paymentsTabFromParam('eventos')).toBe('events');
  });
});

describe('paymentsTabHref (UI-D-513)', () => {
  it('is the bare path for Configuração and carries ?aba= for the others', () => {
    expect(paymentsTabHref('setup')).toBe('/configuracoes/pagamentos');
    expect(paymentsTabHref('access')).toBe('/configuracoes/pagamentos?aba=acessos');
    expect(paymentsTabHref('events')).toBe('/configuracoes/pagamentos?aba=eventos');
  });

  it('round-trips through paymentsTabFromParam', () => {
    for (const tab of PAYMENTS_TABS) {
      const url = new URL(paymentsTabHref(tab), 'https://example.test');
      expect(paymentsTabFromParam(url.searchParams.get('aba') ?? undefined)).toBe(tab);
    }
  });
});
