import {
  FINANCE_OFFERS,
  type FinanceOfferId,
  financeProductOffers,
  ownerBandRoster,
  ownerFinanceIncludes,
  ownerFinanceWindow,
  tenantOwnerPanel,
} from '@rede-social/module-dashboard/fixtures';
import { describe, expect, it } from 'vitest';
import { OWNER_MEMBER_LISTS } from './owner-band-scope';
import {
  FINANCE_ATTENTION_SLUGS,
  FINANCE_NUMBER_SLUGS,
  financeBackHref,
  financeTabView,
  type OwnerFinanceView,
  ownerFinanceHref,
  parseOwnerFinanceView,
} from './owner-finance-view';

type Params = Parameters<typeof parseOwnerFinanceView>[0];

const AREA = '/perfil?area=financeiro';

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

const MONTH = ownerFinanceWindow(0, 29);
const PRODUCT_IDS = tenantOwnerPanel.store.products.map((row) => row.id);

/** The first roster member who bought the offer in the month (the names stay with the web file). */
function buyerOf(offerId: FinanceOfferId): string {
  const id = ownerBandRoster.find((row) =>
    ownerFinanceIncludes({ kind: 'offer', offerId }, row.id),
  )?.id;
  if (!id) throw new Error(`no roster buyer of ${offerId}`);
  return id;
}

describe('parseOwnerFinanceView: the tabs (D-01)', () => {
  it('opens Visão geral with nothing else by default', () => {
    expect(parseOwnerFinanceView({})).toEqual(EMPTY);
    expect(parseOwnerFinanceView({ area: 'financeiro' })).toEqual(EMPTY);
    expect(EMPTY).toMatchObject({
      tab: 'overview',
      number: null,
      attention: null,
      band: null,
      neverBand: null,
      productId: null,
      offerId: null,
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

describe('parseOwnerFinanceView: Produtos → oferta → comprador → lista (D-08)', () => {
  it('opens a product of the store only', () => {
    for (const id of PRODUCT_IDS) {
      expect(parseOwnerFinanceView({ vista: 'produtos', produto: id }).productId).toBe(id);
    }
    for (const produto of ['xyz', 'S2', '', ['s2', 's2']]) {
      expect(
        parseOwnerFinanceView({ vista: 'produtos', produto } as Params),
        String(produto),
      ).toEqual(view({ tab: 'products' }));
    }
  });

  it('opens an offer of the opened product that sold in the month', () => {
    expect(
      parseOwnerFinanceView({ vista: 'produtos', produto: 's2', oferta: 'vip-entrada' }),
    ).toEqual(view({ tab: 'products', productId: 's2', offerId: 'vip-entrada' }));
    // An offer of another product, an unsold one, or no product: one level up.
    expect(
      parseOwnerFinanceView({ vista: 'produtos', produto: 's2', oferta: 'ebook-entrada' }),
    ).toEqual(view({ tab: 'products', productId: 's2' }));
    expect(
      parseOwnerFinanceView({ vista: 'produtos', produto: 's4', oferta: 'workshop-adicional' }),
    ).toEqual(view({ tab: 'products', productId: 's4' }));
    expect(parseOwnerFinanceView({ vista: 'produtos', oferta: 'vip-entrada' })).toEqual(
      view({ tab: 'products' }),
    );
    expect(
      parseOwnerFinanceView({
        vista: 'produtos',
        produto: 's2',
        oferta: ['vip-entrada', 'vip-entrada'],
      }),
    ).toEqual(view({ tab: 'products', productId: 's2' }));
  });

  it('opens a member only from the offer’s buyers, and a list only with a member', () => {
    const buyer = buyerOf('vip-entrada');
    const base = { vista: 'produtos', produto: 's2', oferta: 'vip-entrada' };
    expect(parseOwnerFinanceView({ ...base, membro: buyer })).toEqual(
      view({ tab: 'products', productId: 's2', offerId: 'vip-entrada', memberId: buyer }),
    );
    const outside = ownerBandRoster.find(
      (row) => !ownerFinanceIncludes({ kind: 'offer', offerId: 'vip-entrada' }, row.id),
    )?.id;
    expect(outside).toBeDefined();
    for (const membro of [outside ?? '', 'om-99', '', [buyer, buyer]]) {
      expect(parseOwnerFinanceView({ ...base, membro } as Params), String(membro)).toEqual(
        view({ tab: 'products', productId: 's2', offerId: 'vip-entrada' }),
      );
    }
    for (const lista of OWNER_MEMBER_LISTS) {
      expect(parseOwnerFinanceView({ ...base, membro: buyer, lista }).list).toBe(lista);
    }
    expect(parseOwnerFinanceView({ ...base, membro: buyer, lista: 'xyz' }).list).toBeNull();
    expect(parseOwnerFinanceView({ ...base, lista: 'curtidas' }).list).toBeNull();
    expect(parseOwnerFinanceView({ vista: 'produtos', membro: buyer }).memberId).toBeNull();
  });
});

describe('ownerFinanceHref and financeBackHref', () => {
  const buyer = buyerOf('vip-entrada');

  it('writes the params in a fixed order', () => {
    expect(ownerFinanceHref(EMPTY)).toBe(AREA);
    expect(ownerFinanceHref(view({ tab: 'buyers' }))).toBe(`${AREA}&vista=quem-compra`);
    expect(
      ownerFinanceHref(
        view({
          tab: 'products',
          productId: 's2',
          offerId: 'vip-entrada',
          memberId: buyer,
          list: 'curtidas',
        }),
      ),
    ).toBe(`${AREA}&vista=produtos&produto=s2&oferta=vip-entrada&membro=${buyer}&lista=curtidas`);
  });

  it('goes back exactly one step, landing on what was closed', () => {
    const list = view({
      tab: 'products',
      productId: 's2',
      offerId: 'vip-entrada',
      memberId: buyer,
      list: 'curtidas',
    });
    expect(financeBackHref(list)).toBe(
      `${AREA}&vista=produtos&produto=s2&oferta=vip-entrada&membro=${buyer}#insight-curtidas`,
    );
    expect(financeBackHref({ ...list, list: null })).toBe(
      `${AREA}&vista=produtos&produto=s2&oferta=vip-entrada#membro-${buyer}`,
    );
    expect(financeBackHref({ ...list, list: null, memberId: null })).toBe(
      `${AREA}&vista=produtos&produto=s2#oferta-vip-entrada`,
    );
    expect(financeBackHref({ ...list, list: null, memberId: null, offerId: null })).toBe(
      `${AREA}&vista=produtos#produto-s2`,
    );
    for (const tab of ['overview', 'products', 'buyers'] as const) {
      expect(financeBackHref(financeTabView(tab)), tab).toBeNull();
    }
  });

  it('round-trips every valid Produtos view', () => {
    const views: OwnerFinanceView[] = [];
    for (const productId of PRODUCT_IDS) {
      views.push(view({ tab: 'products', productId }));
      for (const offer of financeProductOffers(productId)) {
        if (MONTH.byOffer[offer.id].orders === 0) continue;
        const withOffer = view({ tab: 'products', productId, offerId: offer.id });
        views.push(withOffer);
        for (const row of ownerBandRoster) {
          if (!ownerFinanceIncludes({ kind: 'offer', offerId: offer.id }, row.id)) continue;
          views.push({ ...withOffer, memberId: row.id });
          views.push({ ...withOffer, memberId: row.id, list: 'acoes-fortes' });
        }
      }
    }
    expect(views.length).toBeGreaterThan(FINANCE_OFFERS.length);
    for (const item of views) {
      expect(
        parseOwnerFinanceView(paramsOf(ownerFinanceHref(item))),
        ownerFinanceHref(item),
      ).toEqual(item);
    }
  });
});

/** The first roster member in a Financeiro list (the names stay with the web file). */
function memberIn(list: Parameters<typeof ownerFinanceIncludes>[0]): string {
  const id = ownerBandRoster.find((row) => ownerFinanceIncludes(list, row.id))?.id;
  if (!id) throw new Error(`no roster member in ${list.kind}`);
  return id;
}

describe('parseOwnerFinanceView: Visão geral (D-07, PD-10, PD-11)', () => {
  it('opens a number of the overview only, by its exact slug', () => {
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

  it('opens an attention row only with no number', () => {
    expect(FINANCE_ATTENTION_SLUGS).toEqual({
      vipFading: 'pagantes-sumindo',
      expiring: 'vencendo',
    });
    expect(parseOwnerFinanceView({ atencao: 'pagantes-sumindo' })).toEqual(
      view({ attention: 'vipFading' }),
    );
    expect(parseOwnerFinanceView({ atencao: 'vencendo' })).toEqual(view({ attention: 'expiring' }));
    expect(parseOwnerFinanceView({ numero: 'recompra', atencao: 'vencendo' })).toEqual(
      view({ number: 'rebought' }),
    );
    expect(parseOwnerFinanceView({ atencao: 'xyz' })).toEqual(EMPTY);
  });

  it('opens a product from the overview (the stalled row, the VIP line), with its cascade', () => {
    expect(parseOwnerFinanceView({ produto: 's4' })).toEqual(view({ productId: 's4' }));
    const buyer = buyerOf('vip-entrada');
    expect(parseOwnerFinanceView({ produto: 's2', oferta: 'vip-entrada', membro: buyer })).toEqual(
      view({ productId: 's2', offerId: 'vip-entrada', memberId: buyer }),
    );
    expect(parseOwnerFinanceView({ numero: 'recompra', produto: 's2' }).productId).toBeNull();
    expect(parseOwnerFinanceView({ atencao: 'vencendo', produto: 's2' }).productId).toBeNull();
    expect(parseOwnerFinanceView({ produto: 'xyz' })).toEqual(EMPTY);
  });

  it('opens a member only from the list it names; the share of add-ons lists none', () => {
    const rebought = memberIn({ kind: 'rebought' });
    expect(parseOwnerFinanceView({ numero: 'recompra', membro: rebought })).toEqual(
      view({ number: 'rebought', memberId: rebought }),
    );
    const outsider = ownerBandRoster.find(
      (row) => !ownerFinanceIncludes({ kind: 'rebought' }, row.id),
    )?.id;
    expect(outsider).toBeDefined();
    expect(parseOwnerFinanceView({ numero: 'recompra', membro: outsider }).memberId).toBeNull();
    expect(
      parseOwnerFinanceView({ numero: 'parte-secundaria', membro: rebought }).memberId,
    ).toBeNull();
    const fading = memberIn({ kind: 'vipFading' });
    expect(parseOwnerFinanceView({ atencao: 'pagantes-sumindo', membro: fading })).toEqual(
      view({ attention: 'vipFading', memberId: fading }),
    );
    expect(parseOwnerFinanceView({ atencao: 'vencendo', membro: fading }).memberId).toBeNull();
    expect(parseOwnerFinanceView({ membro: fading }).memberId).toBeNull();
    expect(
      parseOwnerFinanceView({ numero: 'recompra', membro: rebought, lista: 'curtidas' }).list,
    ).toBe('curtidas');
  });

  it('goes back to the number, the attention row or the product row it came from', () => {
    expect(financeBackHref(view({ number: 'rebought' }))).toBe(`${AREA}#numero-recompra`);
    expect(financeBackHref(view({ attention: 'vipFading' }))).toBe(
      `${AREA}#atencao-pagantes-sumindo`,
    );
    expect(financeBackHref(view({ productId: 's4' }))).toBe(`${AREA}#produto-s4`);
    const member = memberIn({ kind: 'rebought' });
    expect(financeBackHref(view({ number: 'rebought', memberId: member }))).toBe(
      `${AREA}&numero=recompra#membro-${member}`,
    );
    expect(
      ownerFinanceHref(view({ attention: 'vipFading', memberId: member, list: 'curtidas' })),
    ).toBe(`${AREA}&atencao=pagantes-sumindo&membro=${member}&lista=curtidas`);
  });

  it('round-trips every valid overview view', () => {
    const views: OwnerFinanceView[] = [];
    const lists = {
      primary: { kind: 'primary' },
      secondary: { kind: 'secondary' },
      rebought: { kind: 'rebought' },
      timeToSecond: { kind: 'timeToSecond' },
      lifetime: { kind: 'lifetime' },
    } as const;
    for (const number of Object.keys(FINANCE_NUMBER_SLUGS) as NonNullable<
      OwnerFinanceView['number']
    >[]) {
      views.push(view({ number }));
      if (number === 'share') continue;
      for (const row of ownerBandRoster) {
        if (!ownerFinanceIncludes(lists[number], row.id)) continue;
        views.push(view({ number, memberId: row.id }));
        views.push(view({ number, memberId: row.id, list: 'dias-ativos' }));
      }
    }
    for (const attention of ['vipFading', 'expiring'] as const) {
      views.push(view({ attention }));
      for (const row of ownerBandRoster) {
        if (!ownerFinanceIncludes({ kind: attention }, row.id)) continue;
        views.push(view({ attention, memberId: row.id }));
      }
    }
    for (const productId of PRODUCT_IDS) views.push(view({ productId }));
    for (const item of views) {
      expect(
        parseOwnerFinanceView(paramsOf(ownerFinanceHref(item))),
        ownerFinanceHref(item),
      ).toEqual(item);
    }
  });
});

describe('parseOwnerFinanceView: Quem compra (D-09)', () => {
  it('opens a band with buyers only; em risco and inativos fall to the tab', () => {
    expect(parseOwnerFinanceView({ vista: 'quem-compra', faixa: 'engajados' })).toEqual(
      view({ tab: 'buyers', band: 'engaged' }),
    );
    for (const faixa of ['em-risco', 'inativos', 'xyz', ['novos', 'novos']]) {
      expect(
        parseOwnerFinanceView({ vista: 'quem-compra', faixa } as Params),
        String(faixa),
      ).toEqual(view({ tab: 'buyers' }));
    }
    expect(parseOwnerFinanceView({ faixa: 'engajados' }).band).toBeNull();
  });

  it('opens the never-again list of a band with someone in it, only with no band open', () => {
    expect(parseOwnerFinanceView({ vista: 'quem-compra', nunca: 'superfas' })).toEqual(
      view({ tab: 'buyers', neverBand: 'superfan' }),
    );
    expect(parseOwnerFinanceView({ vista: 'quem-compra', nunca: 'xyz' })).toEqual(
      view({ tab: 'buyers' }),
    );
    expect(
      parseOwnerFinanceView({ vista: 'quem-compra', faixa: 'novos', nunca: 'superfas' }),
    ).toEqual(view({ tab: 'buyers', band: 'new' }));
  });

  it('opens a member only from the band or the never-again list it names', () => {
    const engaged = memberIn({ kind: 'band', band: 'engaged' });
    expect(
      parseOwnerFinanceView({ vista: 'quem-compra', faixa: 'engajados', membro: engaged }),
    ).toEqual(view({ tab: 'buyers', band: 'engaged', memberId: engaged }));
    const superfan = memberIn({ kind: 'band', band: 'superfan' });
    expect(
      parseOwnerFinanceView({ vista: 'quem-compra', faixa: 'superfas', membro: engaged }).memberId,
    ).toBeNull();
    expect(
      parseOwnerFinanceView({ vista: 'quem-compra', faixa: 'superfas', membro: superfan }).memberId,
    ).toBe(superfan);
    const single = memberIn({ kind: 'never', band: 'occasional' });
    expect(
      parseOwnerFinanceView({ vista: 'quem-compra', nunca: 'ocasionais', membro: single }),
    ).toEqual(view({ tab: 'buyers', neverBand: 'occasional', memberId: single }));
  });

  it('goes back to the band, reopened, or to the never-again row', () => {
    const engaged = memberIn({ kind: 'band', band: 'engaged' });
    expect(financeBackHref(view({ tab: 'buyers', band: 'engaged', memberId: engaged }))).toBe(
      `${AREA}&vista=quem-compra&faixa=engajados#membro-${engaged}`,
    );
    expect(financeBackHref(view({ tab: 'buyers', band: 'engaged' }))).toBeNull();
    expect(financeBackHref(view({ tab: 'buyers', neverBand: 'occasional' }))).toBe(
      `${AREA}&vista=quem-compra#nunca-ocasionais`,
    );
    const single = memberIn({ kind: 'never', band: 'occasional' });
    expect(
      financeBackHref(view({ tab: 'buyers', neverBand: 'occasional', memberId: single })),
    ).toBe(`${AREA}&vista=quem-compra&nunca=ocasionais#membro-${single}`);
  });

  it('round-trips every valid Quem compra view', () => {
    const views: OwnerFinanceView[] = [];
    for (const band of ['new', 'superfan', 'engaged', 'occasional'] as const) {
      views.push(view({ tab: 'buyers', band }));
      for (const row of ownerBandRoster) {
        if (ownerFinanceIncludes({ kind: 'band', band }, row.id)) {
          views.push(view({ tab: 'buyers', band, memberId: row.id, list: 'curtidas' }));
        }
      }
    }
    for (const neverBand of [
      'new',
      'superfan',
      'engaged',
      'occasional',
      'at_risk',
      'inactive',
    ] as const) {
      views.push(view({ tab: 'buyers', neverBand }));
      for (const row of ownerBandRoster) {
        if (ownerFinanceIncludes({ kind: 'never', band: neverBand }, row.id)) {
          views.push(view({ tab: 'buyers', neverBand, memberId: row.id }));
        }
      }
    }
    for (const item of views) {
      expect(
        parseOwnerFinanceView(paramsOf(ownerFinanceHref(item))),
        ownerFinanceHref(item),
      ).toEqual(item);
    }
  });
});
