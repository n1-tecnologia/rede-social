import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FINANCE_ATTENTION_SLUGS,
  FINANCE_NUMBER_SLUGS,
  financeBackHref,
  financePeopleListOf,
  financeTabView,
  financeViewOfList,
  type OwnerFinanceView,
  ownerFinanceHref,
  parseOwnerFinanceView,
} from './owner-finance-view';

/*
 * The Financeiro URL (08.7-10, R-Pitfall 7): SYNTACTIC. Tabs, numbers, the attention row and bands
 * are slugs from closed lists; a product and a member are uuids. Whether a product is the tenant's
 * is the API's to say (its 404 falls one level up, D-06); offers and expiring accesses are "Em breve"
 * and never a view (D-455, D-465).
 */

type Params = Parameters<typeof parseOwnerFinanceView>[0];

const AREA = '/perfil?area=financeiro';
const PRODUCT = '7a0d2c4e-1b3f-4c5d-8e9f-0a1b2c3d4e5f';
const MEMBER = '9b1e3d5f-2c4a-4b6d-9f0e-1a2b3c4d5e6f';

const EMPTY: OwnerFinanceView = financeTabView('overview');

function view(patch: Partial<OwnerFinanceView>): OwnerFinanceView {
  return { ...EMPTY, ...patch };
}

/** The query of an href, as the page receives it. */
function paramsOf(href: string): Params {
  const query = href.split('#')[0]?.split('?')[1] ?? '';
  const params: Record<string, string | string[]> = {};
  for (const [key, value] of new URLSearchParams(query)) {
    const before = params[key];
    params[key] = before === undefined ? value : [before, value].flat();
  }
  return params;
}

describe('parseOwnerFinanceView: the tabs (D-01)', () => {
  it('opens Visão geral with nothing else by default', () => {
    expect(parseOwnerFinanceView({})).toEqual(EMPTY);
    expect(parseOwnerFinanceView({ area: 'financeiro' })).toEqual(EMPTY);
    expect(EMPTY).toEqual({
      tab: 'overview',
      number: null,
      attention: null,
      band: null,
      neverBand: null,
      productId: null,
      memberId: null,
      list: null,
    });
  });

  it('reads vista exactly and singly, else Visão geral', () => {
    expect(parseOwnerFinanceView({ vista: 'produtos' }).tab).toBe('products');
    expect(parseOwnerFinanceView({ vista: 'quem-compra' }).tab).toBe('buyers');
    for (const vista of ['PRODUTOS', 'xyz', '', ['produtos', 'produtos']]) {
      expect(parseOwnerFinanceView({ vista } as Params), String(vista)).toEqual(EMPTY);
    }
  });
});

describe('parseOwnerFinanceView: a product is a uuid, and offers are not a view (D-455)', () => {
  it('opens any uuid as a product under Produtos, and nothing else', () => {
    expect(parseOwnerFinanceView({ vista: 'produtos', produto: PRODUCT })).toEqual(
      view({ tab: 'products', productId: PRODUCT }),
    );
    for (const produto of ['s2', 'xyz', '', PRODUCT.toUpperCase().slice(1), [PRODUCT, PRODUCT]]) {
      expect(
        parseOwnerFinanceView({ vista: 'produtos', produto } as Params),
        String(produto),
      ).toEqual(view({ tab: 'products' }));
    }
  });

  it('ignores a hand-typed oferta at every level, with no notice', () => {
    expect(parseOwnerFinanceView({ oferta: 'x' })).toEqual(EMPTY);
    expect(parseOwnerFinanceView({ oferta: 'vip-entrada' })).toEqual(EMPTY);
    expect(parseOwnerFinanceView({ vista: 'produtos', produto: PRODUCT, oferta: 'x' })).toEqual(
      view({ tab: 'products', productId: PRODUCT }),
    );
    expect(
      parseOwnerFinanceView({ vista: 'produtos', produto: PRODUCT, oferta: 'x', membro: MEMBER }),
    ).toEqual(view({ tab: 'products', productId: PRODUCT }));
    expect(Object.keys(parseOwnerFinanceView({ oferta: 'x' }))).not.toContain('offerId');
  });

  it('opens a product from Visão geral only with no number nor attention row', () => {
    expect(parseOwnerFinanceView({ produto: PRODUCT })).toEqual(view({ productId: PRODUCT }));
    expect(parseOwnerFinanceView({ numero: 'recompra', produto: PRODUCT }).productId).toBeNull();
    expect(
      parseOwnerFinanceView({ atencao: 'pagantes-sumindo', produto: PRODUCT }).productId,
    ).toBeNull();
    expect(parseOwnerFinanceView({ vista: 'quem-compra', produto: PRODUCT }).productId).toBeNull();
  });
});

describe('parseOwnerFinanceView: Visão geral (D-07)', () => {
  it('opens a number by its exact slug', () => {
    expect(FINANCE_NUMBER_SLUGS).toEqual({
      primary: 'primaria',
      secondary: 'secundaria',
      share: 'parte-secundaria',
      rebought: 'recompra',
      timeToSecond: 'tempo-recompra',
      lifetime: 'por-membro',
    });
    for (const [number, numero] of Object.entries(FINANCE_NUMBER_SLUGS)) {
      expect(parseOwnerFinanceView({ numero })).toEqual(
        view({ number: number as OwnerFinanceView['number'] }),
      );
      expect(parseOwnerFinanceView({ vista: 'produtos', numero }).number).toBeNull();
    }
    for (const numero of ['xyz', 'PRIMARIA', '', ['primaria', 'primaria']]) {
      expect(parseOwnerFinanceView({ numero } as Params), String(numero)).toEqual(EMPTY);
    }
  });

  it('opens the VIP attention row only; the expiring accesses fall to the overview (D-465)', () => {
    expect(FINANCE_ATTENTION_SLUGS).toEqual({ vipFading: 'pagantes-sumindo' });
    expect(parseOwnerFinanceView({ atencao: 'pagantes-sumindo' })).toEqual(
      view({ attention: 'vipFading' }),
    );
    expect(parseOwnerFinanceView({ atencao: 'vencendo' })).toEqual(EMPTY);
    expect(parseOwnerFinanceView({ atencao: 'vencendo', membro: MEMBER })).toEqual(EMPTY);
    expect(parseOwnerFinanceView({ numero: 'recompra', atencao: 'pagantes-sumindo' })).toEqual(
      view({ number: 'rebought' }),
    );
  });

  it('opens a member (a uuid) only from a list of people, and a measured list only with a member', () => {
    for (const number of [
      'primary',
      'secondary',
      'rebought',
      'timeToSecond',
      'lifetime',
    ] as const) {
      expect(
        parseOwnerFinanceView({ numero: FINANCE_NUMBER_SLUGS[number], membro: MEMBER }),
      ).toEqual(view({ number, memberId: MEMBER }));
    }
    // The share of add-ons lists products, not people.
    expect(
      parseOwnerFinanceView({ numero: 'parte-secundaria', membro: MEMBER }).memberId,
    ).toBeNull();
    expect(parseOwnerFinanceView({ atencao: 'pagantes-sumindo', membro: MEMBER })).toEqual(
      view({ attention: 'vipFading', memberId: MEMBER }),
    );
    expect(parseOwnerFinanceView({ membro: MEMBER }).memberId).toBeNull();
    for (const membro of ['om-1', '', [MEMBER, MEMBER]]) {
      expect(
        parseOwnerFinanceView({ numero: 'recompra', membro } as Params).memberId,
        String(membro),
      ).toBeNull();
    }
    const base = { numero: 'recompra', membro: MEMBER };
    for (const lista of ['dias-ativos', 'curtidas', 'comentarios', 'acoes-fortes'] as const) {
      expect(parseOwnerFinanceView({ ...base, lista }).list).toBe(lista);
    }
    // "Publicações vistas" is "Em breve" (D-455): a typed one falls to the member.
    expect(parseOwnerFinanceView({ ...base, lista: 'posts-vistos' }).list).toBeNull();
    expect(parseOwnerFinanceView({ ...base, lista: 'xyz' }).list).toBeNull();
    expect(parseOwnerFinanceView({ numero: 'recompra', lista: 'curtidas' }).list).toBeNull();
  });
});

describe('parseOwnerFinanceView: Quem compra (D-09)', () => {
  it('opens any band by its slug, and the never-again list of a band only with no band open', () => {
    expect(parseOwnerFinanceView({ vista: 'quem-compra', faixa: 'engajados' })).toEqual(
      view({ tab: 'buyers', band: 'engaged' }),
    );
    expect(parseOwnerFinanceView({ vista: 'quem-compra', faixa: 'em-risco' })).toEqual(
      view({ tab: 'buyers', band: 'at_risk' }),
    );
    for (const faixa of ['xyz', 'ENGAJADOS', ['novos', 'novos']]) {
      expect(
        parseOwnerFinanceView({ vista: 'quem-compra', faixa } as Params),
        String(faixa),
      ).toEqual(view({ tab: 'buyers' }));
    }
    expect(parseOwnerFinanceView({ faixa: 'engajados' }).band).toBeNull();
    expect(parseOwnerFinanceView({ vista: 'quem-compra', nunca: 'superfas' })).toEqual(
      view({ tab: 'buyers', neverBand: 'superfan' }),
    );
    expect(
      parseOwnerFinanceView({ vista: 'quem-compra', faixa: 'novos', nunca: 'superfas' }),
    ).toEqual(view({ tab: 'buyers', band: 'new' }));
  });

  it('opens a member from the band’s buyers or the never-again list', () => {
    expect(
      parseOwnerFinanceView({ vista: 'quem-compra', faixa: 'engajados', membro: MEMBER }),
    ).toEqual(view({ tab: 'buyers', band: 'engaged', memberId: MEMBER }));
    expect(
      parseOwnerFinanceView({ vista: 'quem-compra', nunca: 'ocasionais', membro: MEMBER }),
    ).toEqual(view({ tab: 'buyers', neverBand: 'occasional', memberId: MEMBER }));
    expect(parseOwnerFinanceView({ vista: 'quem-compra', membro: MEMBER }).memberId).toBeNull();
  });
});

describe('the people list behind a view (the API’s buyers lists, D-461)', () => {
  it('names the API list of each number, the VIP row, a band and a never-again band', () => {
    expect(financePeopleListOf(view({ number: 'primary' }))).toEqual({ list: 'primary' });
    expect(financePeopleListOf(view({ number: 'secondary' }))).toEqual({ list: 'secondary' });
    expect(financePeopleListOf(view({ number: 'rebought' }))).toEqual({ list: 'rebought' });
    expect(financePeopleListOf(view({ number: 'timeToSecond' }))).toEqual({
      list: 'time-to-second',
    });
    expect(financePeopleListOf(view({ number: 'lifetime' }))).toEqual({ list: 'lifetime' });
    expect(financePeopleListOf(view({ number: 'share' }))).toBeNull();
    expect(financePeopleListOf(view({ attention: 'vipFading' }))).toEqual({ list: 'vip-fading' });
    expect(financePeopleListOf(view({ tab: 'buyers', band: 'engaged' }))).toEqual({
      list: 'band',
      band: 'engaged',
    });
    expect(financePeopleListOf(view({ tab: 'buyers', neverBand: 'new' }))).toEqual({
      list: 'never',
      band: 'new',
    });
    expect(financePeopleListOf(EMPTY)).toBeNull();
  });

  it('rebuilds the view a list’s rows open into, for the pages the island appends', () => {
    for (const item of [
      view({ number: 'primary' }),
      view({ number: 'timeToSecond' }),
      view({ attention: 'vipFading' }),
      view({ tab: 'buyers', band: 'superfan' }),
      view({ tab: 'buyers', neverBand: 'inactive' }),
    ]) {
      const people = financePeopleListOf(item);
      if (!people) throw new Error('a list view with no list');
      expect(financeViewOfList(people.list, people.band)).toEqual(item);
    }
    expect(financeViewOfList('band', undefined)).toBeNull();
    expect(financeViewOfList('product', undefined)).toBeNull();
  });
});

describe('ownerFinanceHref and financeBackHref', () => {
  it('writes the params in a fixed order', () => {
    expect(ownerFinanceHref(EMPTY)).toBe(AREA);
    expect(ownerFinanceHref(view({ tab: 'buyers' }))).toBe(`${AREA}&vista=quem-compra`);
    expect(ownerFinanceHref(view({ tab: 'products', productId: PRODUCT }))).toBe(
      `${AREA}&vista=produtos&produto=${PRODUCT}`,
    );
    expect(
      ownerFinanceHref(view({ attention: 'vipFading', memberId: MEMBER, list: 'curtidas' })),
    ).toBe(`${AREA}&atencao=pagantes-sumindo&membro=${MEMBER}&lista=curtidas`);
    expect(ownerFinanceHref(view({ tab: 'buyers', band: 'engaged', memberId: MEMBER }))).toBe(
      `${AREA}&vista=quem-compra&faixa=engajados&membro=${MEMBER}`,
    );
  });

  it('goes back exactly one step, landing on what was closed', () => {
    const list = view({ number: 'rebought', memberId: MEMBER, list: 'curtidas' });
    expect(financeBackHref(list)).toBe(`${AREA}&numero=recompra&membro=${MEMBER}#insight-curtidas`);
    expect(financeBackHref({ ...list, list: null })).toBe(
      `${AREA}&numero=recompra#membro-${MEMBER}`,
    );
    expect(financeBackHref(view({ number: 'rebought' }))).toBe(`${AREA}#numero-recompra`);
    expect(financeBackHref(view({ attention: 'vipFading' }))).toBe(
      `${AREA}#atencao-pagantes-sumindo`,
    );
    expect(financeBackHref(view({ productId: PRODUCT }))).toBe(`${AREA}#produto-${PRODUCT}`);
    expect(financeBackHref(view({ tab: 'products', productId: PRODUCT }))).toBe(
      `${AREA}&vista=produtos#produto-${PRODUCT}`,
    );
    expect(financeBackHref(view({ tab: 'buyers', band: 'engaged', memberId: MEMBER }))).toBe(
      `${AREA}&vista=quem-compra&faixa=engajados#membro-${MEMBER}`,
    );
    expect(financeBackHref(view({ tab: 'buyers', neverBand: 'occasional' }))).toBe(
      `${AREA}&vista=quem-compra#nunca-ocasionais`,
    );
    // An open band is still a tab screen.
    expect(financeBackHref(view({ tab: 'buyers', band: 'engaged' }))).toBeNull();
    for (const tab of ['overview', 'products', 'buyers'] as const) {
      expect(financeBackHref(financeTabView(tab)), tab).toBeNull();
    }
  });

  it('round-trips every valid view shape', () => {
    const views: OwnerFinanceView[] = [
      view({ tab: 'products' }),
      view({ tab: 'products', productId: PRODUCT }),
      view({ productId: PRODUCT }),
      view({ number: 'share' }),
      view({ attention: 'vipFading' }),
      view({ attention: 'vipFading', memberId: MEMBER }),
      view({ tab: 'buyers', band: 'at_risk' }),
      view({ tab: 'buyers', band: 'new', memberId: MEMBER, list: 'acoes-fortes' }),
      view({ tab: 'buyers', neverBand: 'inactive', memberId: MEMBER }),
    ];
    for (const number of Object.keys(FINANCE_NUMBER_SLUGS) as NonNullable<
      OwnerFinanceView['number']
    >[]) {
      views.push(view({ number }));
      if (number === 'share') continue;
      views.push(view({ number, memberId: MEMBER }));
      views.push(view({ number, memberId: MEMBER, list: 'dias-ativos' }));
    }
    for (const item of views) {
      expect(
        parseOwnerFinanceView(paramsOf(ownerFinanceHref(item))),
        ownerFinanceHref(item),
      ).toEqual(item);
    }
  });
});

describe('the parser reads no fixture (INSIGHT-17)', () => {
  it('imports nothing from the dashboard fixtures', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'owner-finance-view.ts'), 'utf8');
    expect(source).not.toMatch(/module-dashboard\/fixtures/);
  });
});
