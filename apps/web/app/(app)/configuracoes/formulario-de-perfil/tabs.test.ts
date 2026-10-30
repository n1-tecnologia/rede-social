import { describe, expect, it } from 'vitest';
import { PROFILE_FORM_TABS, parseTab, profileFormTabHref } from './tabs';

/**
 * 12-15 — the Formulário de perfil tab registry (UI-D-564, UI-D-565). Perguntas is the entry: no value,
 * an empty one, an unknown one and a repeated one all read as it, and its href is the bare path.
 */

describe('PROFILE_FORM_TABS (UI-D-564)', () => {
  it('lists Perguntas then Arquivadas', () => {
    expect(PROFILE_FORM_TABS).toEqual(['questions', 'archived']);
  });
});

describe('parseTab', () => {
  it('reads no value, an empty value, an unknown value and a repeated one as Perguntas', () => {
    expect(parseTab(undefined)).toBe('questions');
    expect(parseTab('')).toBe('questions');
    expect(parseTab('foo')).toBe('questions');
    expect(parseTab(['arquivadas', 'arquivadas'])).toBe('questions');
    expect(parseTab(['arquivadas'])).toBe('questions');
  });

  it('is exact: case, padding and the English key do not select the archived tab', () => {
    expect(parseTab('ARQUIVADAS')).toBe('questions');
    expect(parseTab(' arquivadas')).toBe('questions');
    expect(parseTab('archived')).toBe('questions');
  });

  it('answers the archived tab for its own pt-BR value', () => {
    expect(parseTab('arquivadas')).toBe('archived');
  });
});

describe('profileFormTabHref', () => {
  it('is the bare path for Perguntas and carries ?aba= for Arquivadas', () => {
    expect(profileFormTabHref('questions')).toBe('/configuracoes/formulario-de-perfil');
    expect(profileFormTabHref('archived')).toBe(
      '/configuracoes/formulario-de-perfil?aba=arquivadas',
    );
  });

  it('round-trips through parseTab', () => {
    for (const tab of PROFILE_FORM_TABS) {
      const url = new URL(profileFormTabHref(tab), 'https://example.test');
      expect(parseTab(url.searchParams.get('aba') ?? undefined)).toBe(tab);
    }
  });
});
