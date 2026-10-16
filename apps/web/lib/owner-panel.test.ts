import { describe, expect, it } from 'vitest';
import {
  isOwnerPanelQuery,
  OWNER_ADMIN_HREF,
  OWNER_AREAS,
  OWNER_PANEL_PATH,
  ownerAreaHref,
  parseOwnerArea,
} from './owner-panel';

describe('parseOwnerArea', () => {
  it('lists the areas in tab order', () => {
    expect(OWNER_AREAS).toEqual([
      'visao-geral',
      'membros',
      'conteudo',
      'eventos',
      'financeiro',
      'atendimento',
    ]);
  });

  it('returns an allow-listed area, and Visão geral without one', () => {
    expect(parseOwnerArea({})).toBe('visao-geral');
    expect(parseOwnerArea({ area: 'membros' })).toBe('membros');
    expect(parseOwnerArea({ area: 'conteudo' })).toBe('conteudo');
    expect(parseOwnerArea({ area: 'atendimento' })).toBe('atendimento');
    for (const area of OWNER_AREAS) expect(parseOwnerArea({ area })).toBe(area);
  });

  it('falls back to Visão geral for anything else', () => {
    for (const area of ['', 'MEMBROS', 'xyz', '__proto__', 'constructor', 'membros ', 'loja']) {
      expect(parseOwnerArea({ area }), JSON.stringify(area)).toBe('visao-geral');
    }
    expect(parseOwnerArea({ area: ['membros', 'membros'] })).toBe('visao-geral');
    expect(parseOwnerArea({ area: undefined })).toBe('visao-geral');
  });
});

describe('the panel’s links (2026-10-15: on /perfil, never the preview)', () => {
  it('links each area on /perfil', () => {
    expect(OWNER_PANEL_PATH).toBe('/perfil');
    expect(ownerAreaHref('membros')).toBe('/perfil?area=membros');
    expect(ownerAreaHref('visao-geral')).toBe('/perfil?area=visao-geral');
    for (const area of OWNER_AREAS) expect(ownerAreaHref(area)).not.toContain('painel-preview');
  });

  it('sends "Ver operação do dia" to Configurações, the app having no client admin panel', () => {
    expect(OWNER_ADMIN_HREF).toBe('/configuracoes');
  });

  it('lands on the panel only when the page came from it (every panel link carries ?area=)', () => {
    expect(isOwnerPanelQuery({})).toBe(false);
    expect(isOwnerPanelQuery({ tab: 'x' })).toBe(false);
    expect(isOwnerPanelQuery({ area: 'membros' })).toBe(true);
    expect(isOwnerPanelQuery({ area: 'nada' })).toBe(true);
  });
});
