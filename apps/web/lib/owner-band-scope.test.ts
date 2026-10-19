import { ENGAGEMENT_BAND_ORDER } from '@rede-social/module-dashboard/ui';
import { describe, expect, it } from 'vitest';
import {
  OWNER_BAND_SLUGS,
  OWNER_BANDS_ANCHOR,
  OWNER_MEASURED_LISTS,
  OWNER_MEMBER_LIST_ANCHOR,
  OWNER_MEMBER_LISTS,
  type OwnerMeasuredListSlug,
  type OwnerMembersView,
  ownerBandListParams,
  ownerInsightAnchor,
  ownerListScope,
  ownerMembersHref,
  ownerWaitlistAnchor,
  ownerWaitlistHref,
  parseOwnerMembersView,
} from './owner-band-scope';

/**
 * The Membros cascade's URL on real data (08.7-05, R-Pitfall 7, UI-D-471): the parser is SYNTACTIC
 * — slugs from closed lists, ids that are uuids — and holds no fixture. Whether a uuid is a community,
 * an event or a member of the opened list is the API's answer (a 404 falls one level up, D-06).
 */

type Params = Parameters<typeof parseOwnerMembersView>[0];

const AREA = '/perfil?area=membros';
const ON = { communities: true, events: true };
const COMMUNITY = '7c1a6f0e-3a51-4d0b-9a77-1b2c3d4e5f60';
const EVENT = '0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f';
const MEMBER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function view(
  kind: OwnerMembersView['kind'],
  band: OwnerMembersView['band'] = null,
  itemId: string | null = null,
  memberId: string | null = null,
  list: OwnerMeasuredListSlug | null = null,
): OwnerMembersView {
  return { kind, band, itemId, memberId, list };
}

function parse(params: Params, flags = ON) {
  return parseOwnerMembersView(params, flags);
}

describe('OWNER_BAND_SLUGS (quick 261012-qer B-3)', () => {
  it('maps each band to one slug and back', () => {
    expect(OWNER_BAND_SLUGS).toEqual({
      new: 'novos',
      superfan: 'superfas',
      engaged: 'engajados',
      occasional: 'ocasionais',
      at_risk: 'em-risco',
      inactive: 'inativos',
    });
    for (const [band, faixa] of Object.entries(OWNER_BAND_SLUGS)) {
      expect(parse({ faixa }).band).toBe(band);
    }
  });

  it('reads no band without a slug, or for anything but a slug', () => {
    expect(parse({}).band).toBeNull();
    for (const faixa of ['at_risk', 'Em-risco', 'em-risco ', '', '__proto__', ['novos', 'novos']]) {
      expect(parse({ faixa }).band, JSON.stringify(faixa)).toBeNull();
    }
  });
});

describe('parseOwnerMembersView: the cascade levels, syntactic (R-Pitfall 7)', () => {
  it('opens each tab on its closed bands', () => {
    expect(parse({})).toEqual(view('member'));
    expect(parse({ recorte: 'membro' })).toEqual(view('member'));
    expect(parse({ recorte: 'comunidade' })).toEqual(view('community'));
    expect(parse({ recorte: 'evento' })).toEqual(view('event'));
  });

  it('opens a band, then a community or an event inside it, by uuid', () => {
    expect(parse({ recorte: 'comunidade', faixa: 'engajados' })).toEqual(
      view('community', 'engaged'),
    );
    expect(parse({ recorte: 'comunidade', comunidade: COMMUNITY, faixa: 'engajados' })).toEqual(
      view('community', 'engaged', COMMUNITY),
    );
    expect(parse({ recorte: 'evento', evento: EVENT, faixa: 'engajados' })).toEqual(
      view('event', 'engaged', EVENT),
    );
  });

  it('falls to the band’s cards for a community or event that is not a uuid', () => {
    for (const comunidade of ['vip', 'c-vip', '', '__proto__', `${COMMUNITY} `, [COMMUNITY]]) {
      expect(
        parse({ recorte: 'comunidade', comunidade, faixa: 'engajados' }),
        JSON.stringify(comunidade),
      ).toEqual(view('community', 'engaged'));
    }
    for (const evento of ['u1', 'e2', '', 'constructor', [EVENT, EVENT]]) {
      expect(
        parse({ recorte: 'evento', evento, faixa: 'engajados' }),
        JSON.stringify(evento),
      ).toEqual(view('event', 'engaged'));
    }
    // The other tab's parameter is ignored.
    expect(parse({ recorte: 'comunidade', evento: EVENT, faixa: 'engajados' })).toEqual(
      view('community', 'engaged'),
    );
  });

  it('falls to the closed bands for an item with no band', () => {
    expect(parse({ recorte: 'comunidade', comunidade: COMMUNITY })).toEqual(view('community'));
    expect(parse({ recorte: 'evento', evento: EVENT })).toEqual(view('event'));
  });

  it('reads any other recorte as Por membro, ignoring comunidade and evento', () => {
    const values: Params['recorte'][] = [
      'COMUNIDADE',
      '',
      '__proto__',
      ['evento', 'evento'],
      'evento ',
    ];
    for (const recorte of values) {
      expect(
        parse({ recorte, comunidade: COMMUNITY, evento: EVENT, faixa: 'engajados' }),
        JSON.stringify(recorte),
      ).toEqual(view('member', 'engaged'));
    }
  });
});

describe('parseOwnerMembersView: a scope whose module is off (D-460, UI-D-471)', () => {
  it('renders Por membro for Por comunidade with communities off, with no notice', () => {
    const flags = { communities: false, events: true };
    expect(parse({ recorte: 'comunidade' }, flags)).toEqual(view('member'));
    expect(
      parse({ recorte: 'comunidade', comunidade: COMMUNITY, faixa: 'engajados' }, flags),
    ).toEqual(view('member', 'engaged'));
    expect(parse({ recorte: 'evento' }, flags)).toEqual(view('event'));
  });

  it('renders Por membro for Por evento with events off', () => {
    const flags = { communities: true, events: false };
    expect(parse({ recorte: 'evento', evento: EVENT, faixa: 'novos' }, flags)).toEqual(
      view('member', 'new'),
    );
    expect(parse({ recorte: 'comunidade' }, flags)).toEqual(view('community'));
  });
});

describe('parseOwnerMembersView: the member level (D-06, the API judges the id)', () => {
  it('keeps a uuid member opened from a band, for the API to judge', () => {
    expect(parse({ faixa: 'superfas', membro: MEMBER })).toEqual(
      view('member', 'superfan', null, MEMBER),
    );
    expect(
      parse({ recorte: 'comunidade', comunidade: COMMUNITY, faixa: 'ocasionais', membro: MEMBER }),
    ).toEqual(view('community', 'occasional', COMMUNITY, MEMBER));
    expect(parse({ recorte: 'evento', evento: EVENT, faixa: 'engajados', membro: MEMBER })).toEqual(
      view('event', 'engaged', EVENT, MEMBER),
    );
  });

  it('opens no member that is not a uuid', () => {
    for (const membro of ['om-13', 'OM-01', '', '__proto__', `${MEMBER}x`, [MEMBER]]) {
      expect(parse({ faixa: 'novos', membro }).memberId, JSON.stringify(membro)).toBeNull();
    }
  });

  it('opens no member without the levels above it (a band, and the item off Por membro)', () => {
    expect(parse({ membro: MEMBER })).toEqual(view('member'));
    expect(parse({ recorte: 'comunidade', faixa: 'engajados', membro: MEMBER })).toEqual(
      view('community', 'engaged'),
    );
  });
});

describe('the member lists (D-461)', () => {
  it('keeps the five shipped slugs and measures four of them', () => {
    expect(OWNER_MEMBER_LISTS).toEqual([
      'dias-ativos',
      'curtidas',
      'comentarios',
      'acoes-fortes',
      'posts-vistos',
    ]);
    expect(OWNER_MEASURED_LISTS).toEqual({
      'dias-ativos': 'active-days',
      curtidas: 'likes',
      comentarios: 'comments',
      'acoes-fortes': 'strong-actions',
    });
    expect(OWNER_MEMBER_LIST_ANCHOR).toBe('lista');
    expect(ownerInsightAnchor('curtidas')).toBe('insight-curtidas');
  });

  it('opens a measured list of a member', () => {
    for (const slug of Object.keys(OWNER_MEASURED_LISTS)) {
      expect(parse({ faixa: 'superfas', membro: MEMBER, lista: slug }).list, slug).toBe(slug);
    }
  });

  it('falls to the detail for posts-vistos (Em breve) and for anything else', () => {
    for (const lista of ['posts-vistos', 'CURTIDAS', 'curtidas ', '', ['curtidas', 'curtidas']]) {
      expect(parse({ faixa: 'superfas', membro: MEMBER, lista }), JSON.stringify(lista)).toEqual(
        view('member', 'superfan', null, MEMBER),
      );
    }
    expect(parse({ faixa: 'novos', lista: 'curtidas' })).toEqual(view('member', 'new'));
  });
});

describe('ownerListScope and ownerBandListParams', () => {
  it('is the whole base, the opened item, or none while a band shows its cards', () => {
    expect(ownerListScope(view('member', 'engaged'))).toEqual({ kind: 'member' });
    expect(ownerListScope(view('community', 'engaged', COMMUNITY))).toEqual({
      kind: 'community',
      id: COMMUNITY,
    });
    expect(ownerListScope(view('event', 'engaged', EVENT))).toEqual({ kind: 'event', id: EVENT });
    expect(ownerListScope(view('community', 'engaged'))).toBeNull();
  });

  it('names the API band list of a view', () => {
    expect(ownerBandListParams(view('member'), 'at_risk')).toEqual({
      band: 'at_risk',
      scope: 'base',
    });
    expect(ownerBandListParams(view('community', 'engaged', COMMUNITY), 'engaged')).toEqual({
      band: 'engaged',
      scope: 'community',
      scopeId: COMMUNITY,
    });
    expect(ownerBandListParams(view('event', 'new', EVENT), 'new')).toEqual({
      band: 'new',
      scope: 'event',
      scopeId: EVENT,
    });
    expect(ownerBandListParams(view('event', 'new'), 'new')).toBeNull();
  });
});

describe('ownerMembersHref', () => {
  it('links each level, landing on the bands until a member opens', () => {
    expect(OWNER_BANDS_ANCHOR).toBe('faixas');
    expect(ownerMembersHref(view('member'))).toBe(`${AREA}#faixas`);
    expect(ownerMembersHref(view('community'))).toBe(`${AREA}&recorte=comunidade#faixas`);
    expect(ownerMembersHref(view('event', 'engaged', EVENT))).toBe(
      `${AREA}&recorte=evento&evento=${EVENT}&faixa=engajados#faixas`,
    );
    expect(ownerMembersHref(view('community', 'occasional', COMMUNITY, MEMBER))).toBe(
      `${AREA}&recorte=comunidade&comunidade=${COMMUNITY}&faixa=ocasionais&membro=${MEMBER}`,
    );
    expect(ownerMembersHref(view('member', 'superfan', null, MEMBER, 'curtidas'))).toBe(
      `${AREA}&faixa=superfas&membro=${MEMBER}&lista=curtidas#lista`,
    );
  });

  it('round-trips every reachable view through the parser', () => {
    const items = { member: [null], community: [null, COMMUNITY], event: [null, EVENT] } as const;
    let checked = 0;
    for (const kind of ['member', 'community', 'event'] as const) {
      for (const band of [null, ...ENGAGEMENT_BAND_ORDER]) {
        for (const itemId of items[kind]) {
          if (itemId !== null && band === null) continue;
          const opens = band !== null && (kind === 'member' || itemId !== null);
          for (const memberId of opens ? [null, MEMBER] : [null]) {
            const lists = memberId ? [null, ...Object.keys(OWNER_MEASURED_LISTS)] : [null];
            for (const list of lists as (OwnerMeasuredListSlug | null)[]) {
              const target = view(kind, band, itemId, memberId, list);
              const query = new URL(ownerMembersHref(target), 'http://x').searchParams;
              expect(parse(Object.fromEntries(query)), JSON.stringify(target)).toEqual(target);
              checked += 1;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(80);
  });
});

describe('the waiting list of an event (quick 261014-ia8 F-1)', () => {
  it('anchors each event on its Lista de espera row, in the Eventos area', () => {
    expect(ownerWaitlistAnchor('u3')).toBe('espera-u3');
    expect(ownerWaitlistHref('u3')).toBe('/perfil?area=eventos#espera-u3');
  });
});
