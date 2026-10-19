import { describe, expect, it } from 'vitest';
import {
  areaChipSpan,
  isOwnerPanelQuery,
  OWNER_ADMIN_HREF,
  OWNER_AREAS,
  OWNER_PANEL_PATH,
  type OwnerPanelFlags,
  ownerAreaHref,
  ownerPanelFlags,
  parseOwnerArea,
  visibleOwnerAreas,
} from './owner-panel';

/** Every panel module on, as rede-demo. */
const ALL_ON: OwnerPanelFlags = ownerPanelFlags(
  ['feed', 'stories', 'communities', 'events', 'store', 'chat', 'notifications'].map((key) => ({
    key,
  })),
);
/** rede-lab: feed and events on, everything else off. */
const LAB: OwnerPanelFlags = ownerPanelFlags([{ key: 'feed' }, { key: 'events' }]);

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
    expect(parseOwnerArea({}, ALL_ON)).toBe('visao-geral');
    expect(parseOwnerArea({ area: 'membros' }, ALL_ON)).toBe('membros');
    expect(parseOwnerArea({ area: 'conteudo' }, ALL_ON)).toBe('conteudo');
    expect(parseOwnerArea({ area: 'atendimento' }, ALL_ON)).toBe('atendimento');
    for (const area of OWNER_AREAS) expect(parseOwnerArea({ area }, ALL_ON)).toBe(area);
  });

  it('falls back to Visão geral for anything else', () => {
    for (const area of ['', 'MEMBROS', 'xyz', '__proto__', 'constructor', 'membros ', 'loja']) {
      expect(parseOwnerArea({ area }, ALL_ON), JSON.stringify(area)).toBe('visao-geral');
    }
    expect(parseOwnerArea({ area: ['membros', 'membros'] }, ALL_ON)).toBe('visao-geral');
    expect(parseOwnerArea({ area: undefined }, ALL_ON)).toBe('visao-geral');
  });
});

describe('08.7-12 module-gated areas (D-460, UI-D-471, UI-D-473, UI-D-474)', () => {
  it('visibleOwnerAreas keeps the six areas, in order, with every module on', () => {
    expect(visibleOwnerAreas(ALL_ON)).toEqual([
      'visao-geral',
      'membros',
      'conteudo',
      'eventos',
      'financeiro',
      'atendimento',
    ]);
  });

  it('rede-lab ({ feed, events }) shows Visão geral, Membros, Conteúdo and Eventos', () => {
    expect(visibleOwnerAreas(LAB)).toEqual(['visao-geral', 'membros', 'conteudo', 'eventos']);
  });

  it('Conteúdo is hidden only when feed AND stories are both off (UI-D-473)', () => {
    expect(visibleOwnerAreas({ ...ALL_ON, feed: false })).toContain('conteudo');
    expect(visibleOwnerAreas({ ...ALL_ON, stories: false })).toContain('conteudo');
    expect(visibleOwnerAreas({ ...ALL_ON, feed: false, stories: false })).not.toContain('conteudo');
  });

  it('Eventos needs events, Financeiro store and Atendimento chat; Visão geral and Membros always stay', () => {
    const none = ownerPanelFlags([]);
    expect(visibleOwnerAreas(none)).toEqual(['visao-geral', 'membros']);
    expect(visibleOwnerAreas({ ...ALL_ON, events: false })).not.toContain('eventos');
    expect(visibleOwnerAreas({ ...ALL_ON, store: false })).not.toContain('financeiro');
    expect(visibleOwnerAreas({ ...ALL_ON, chat: false })).not.toContain('atendimento');
  });

  it('areaChipSpan: 6 → 3 + 3 (span 2), 5 → 3 + 2 (2, then 3), 4 → 2 + 2 (3), 3 → 3 (2), 2 → 2 (3)', () => {
    const spans = (count: number) =>
      Array.from({ length: count }, (_, i) => areaChipSpan(i, count));
    expect(spans(6)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(spans(5)).toEqual([2, 2, 2, 3, 3]);
    expect(spans(4)).toEqual([3, 3, 3, 3]);
    expect(spans(3)).toEqual([2, 2, 2]);
    expect(spans(2)).toEqual([3, 3]);
    // No empty track: every row's spans add up to the six tracks.
    for (const count of [2, 3, 4, 5, 6]) {
      expect(spans(count).reduce((sum, span) => sum + span, 0) % 6, String(count)).toBe(0);
    }
  });

  it('parseOwnerArea renders Visão geral for a hidden area, with no other effect (T-08.7-24)', () => {
    expect(parseOwnerArea({ area: 'financeiro' }, LAB)).toBe('visao-geral');
    expect(parseOwnerArea({ area: 'atendimento' }, LAB)).toBe('visao-geral');
    expect(parseOwnerArea({ area: 'eventos' }, LAB)).toBe('eventos');
    expect(parseOwnerArea({ area: 'conteudo' }, { ...ALL_ON, feed: false, stories: false })).toBe(
      'visao-geral',
    );
    expect(parseOwnerArea({ area: 'financeiro', produto: 'x', vista: 'produtos' }, LAB)).toBe(
      'visao-geral',
    );
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
