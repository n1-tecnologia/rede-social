import { describe, expect, it } from 'vitest';
import {
  isOwnerPanelQuery,
  OWNER_ADMIN_HREF,
  OWNER_AREAS,
  OWNER_PANEL_PATH,
  ownerAreaHref,
  ownerPanelFlags,
  parseOwnerArea,
} from './owner-panel';

describe('ownerPanelFlags (08.7-05, D-460): the panel’s module flags, read once on /perfil', () => {
  it('turns on exactly the modules the bootstrap lists', () => {
    expect(ownerPanelFlags([{ key: 'events' }])).toEqual({
      feed: false,
      stories: false,
      communities: false,
      events: true,
      store: false,
      chat: false,
      notifications: false,
    });
  });

  it('reads every panel module, and ignores the others', () => {
    const all = ['feed', 'stories', 'communities', 'events', 'store', 'chat', 'notifications'];
    const flags = ownerPanelFlags([...all, 'courses', 'member-directory'].map((key) => ({ key })));
    expect(Object.keys(flags).sort()).toEqual([...all].sort());
    for (const key of all) expect(flags[key as keyof typeof flags], key).toBe(true);
    expect(ownerPanelFlags([])).toEqual(
      Object.fromEntries(all.map((key) => [key, false])) as typeof flags,
    );
  });
});

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
