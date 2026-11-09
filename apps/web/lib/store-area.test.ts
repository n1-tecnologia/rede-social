import { describe, expect, it } from 'vitest';
import {
  legacyStoreFilterRedirect,
  STORE_ARCHIVED_QUERY,
  STORE_MANAGE_LISTS,
  STORE_MANAGE_PATH,
  STORE_OWNED_PATH,
  STORE_PATH,
  STORE_SCREENS,
  storeAreas,
  storeManageFilter,
  storeManageHref,
  storeManageListFromParam,
} from './store-area';

/** Echoes the key, so a row's label names the catalog key it reads. */
const t = (key: string) => key;

describe('the store paths (2026-10-24, the Loja area)', () => {
  it('keeps the catalogue on /loja and gives Comprados and Gerenciar their own paths', () => {
    expect(STORE_PATH).toBe('/loja');
    expect(STORE_OWNED_PATH).toBe('/loja/comprados');
    expect(STORE_MANAGE_PATH).toBe('/loja/gerenciar');
  });
});

describe('STORE_SCREENS (ORDER IS THE CONTRACT)', () => {
  it('lists Produtos then Comprados, each with its path, catalogue filter, icon and label key', () => {
    expect(
      STORE_SCREENS.map((screen) => [
        screen.key,
        screen.path,
        screen.filter,
        screen.icon,
        screen.labelKey,
      ]),
    ).toEqual([
      ['produtos', '/loja', 'all', 'shopping-bag', 'store.area.screens.products'],
      ['comprados', '/loja/comprados', 'owned', 'package-check', 'store.area.screens.owned'],
    ]);
  });
});

describe('storeAreas', () => {
  it('gives a member one area, "Loja", with Produtos and Comprados only', () => {
    const areas = storeAreas({ canManage: false, t });
    expect(areas).toHaveLength(1);
    expect(areas[0]?.label).toBe('store.area.label');
    expect(areas[0]?.menuLabel).toBe('store.area.menu');
    expect(areas[0]?.screens).toEqual([
      {
        key: 'store-produtos',
        href: '/loja',
        icon: 'shopping-bag',
        label: 'store.area.screens.products',
      },
      {
        key: 'store-comprados',
        href: '/loja/comprados',
        icon: 'package-check',
        label: 'store.area.screens.owned',
      },
    ]);
  });

  it('ends a manager\'s menu with "Gerenciar", which gathers no other page (no matches)', () => {
    const screens = storeAreas({ canManage: true, t })[0]?.screens ?? [];
    expect(screens.map((screen) => screen.key)).toEqual([
      'store-produtos',
      'store-comprados',
      'store-manage',
    ]);
    expect(screens[2]).toEqual({
      key: 'store-manage',
      href: '/loja/gerenciar',
      icon: 'sliders-horizontal',
      label: 'store.area.screens.manage',
    });
    expect(screens.some((screen) => 'matches' in screen)).toBe(false);
  });

  it("declares no `within` variant: the area is the store slot's pages", () => {
    expect(storeAreas({ canManage: true, t })[0]).not.toHaveProperty('within');
  });
});

describe("Gerenciar's lists", () => {
  it('orders the active list first', () => {
    expect(STORE_MANAGE_LISTS).toEqual(['active', 'archived']);
  });

  it('reads only a single exact `arquivados` as the archived list', () => {
    expect(storeManageListFromParam(STORE_ARCHIVED_QUERY)).toBe('archived');
    for (const value of [undefined, '', 'ARQUIVADOS', 'arquivado', 'todos', ['arquivados']]) {
      expect(storeManageListFromParam(value)).toBe('active');
    }
  });

  it('builds the bare path for the active list and ?filtro=arquivados for the archived one', () => {
    expect(storeManageHref('active')).toBe('/loja/gerenciar');
    expect(storeManageHref('archived')).toBe('/loja/gerenciar?filtro=arquivados');
  });

  it("maps the active list to the catalogue's `all` (active products) and the archived to `archived`", () => {
    expect(storeManageFilter('active')).toBe('all');
    expect(storeManageFilter('archived')).toBe('archived');
  });
});

describe('legacyStoreFilterRedirect (the old /loja?filtro= links)', () => {
  it('sends ?filtro=comprados to Comprados, for everyone', () => {
    expect(legacyStoreFilterRedirect('comprados', false)).toBe('/loja/comprados');
    expect(legacyStoreFilterRedirect('comprados', true)).toBe('/loja/comprados');
  });

  it("sends ?filtro=arquivados to Gerenciar's archived list for a manager, to Produtos otherwise", () => {
    expect(legacyStoreFilterRedirect('arquivados', true)).toBe('/loja/gerenciar?filtro=arquivados');
    expect(legacyStoreFilterRedirect('arquivados', false)).toBe('/loja');
  });

  it('stays on Produtos for anything else (no value, unknown, another case, a repeated param)', () => {
    for (const value of [undefined, '', 'todos', 'Comprados', ['comprados'], ['arquivados', 'x']]) {
      expect(legacyStoreFilterRedirect(value, true)).toBeNull();
      expect(legacyStoreFilterRedirect(value, false)).toBeNull();
    }
  });
});
