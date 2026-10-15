import {
  type ContentItem,
  type ContentWho,
  ownerBandRoster,
  ownerContentIncludes,
  ownerContentInteractorIncludes,
  ownerContentItems,
} from '@rede-social/module-dashboard/fixtures';
import { describe, expect, it } from 'vitest';
import { OWNER_BAND_SLUGS, OWNER_MEMBER_LISTS } from './owner-band-scope';
import {
  CONTENT_KIND_SLUGS,
  CONTENT_NUMBER_SLUGS,
  CONTENT_WHO_SLUGS,
  contentAttentionAnchor,
  contentBackHref,
  contentCoverRatio,
  contentRecommendation,
  needsAttention,
  type OwnerContentView,
  ownerContentHref,
  parseOwnerContentView,
} from './owner-content-view';

type Params = Parameters<typeof parseOwnerContentView>[0];

const AREA = '/perfil?area=conteudo';

const EMPTY: OwnerContentView = {
  tab: 'overview',
  number: null,
  band: null,
  kind: null,
  postId: null,
  who: null,
  memberId: null,
  list: null,
  reply: null,
};

function view(patch: Partial<OwnerContentView>): OwnerContentView {
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

/** The first roster member in an item's list (the lists stay OwnerContentPeople.tsx's to read). */
function firstIn(postId: string, who: ContentWho): string | undefined {
  return ownerBandRoster.find((row) => ownerContentIncludes(postId, who, row.id))?.id;
}

function firstLiker(postId: string): string {
  const id = firstIn(postId, 'likes');
  if (!id) throw new Error(`no likers for ${postId}`);
  return id;
}

function firstInteractor(band: Parameters<typeof ownerContentInteractorIncludes>[0]): string {
  const id = ownerBandRoster.find((row) => ownerContentInteractorIncludes(band, row.id))?.id;
  if (!id) throw new Error(`no interactor in ${band}`);
  return id;
}

const POSTS = ownerContentItems.filter((item) => item.kind !== 'story');

describe('parseOwnerContentView: the tabs (D-01)', () => {
  it('opens Visão geral with nothing else by default', () => {
    expect(parseOwnerContentView({})).toEqual(EMPTY);
    expect(parseOwnerContentView({ area: 'conteudo' })).toEqual(EMPTY);
  });

  it('reads vista exactly and singly, else Visão geral', () => {
    expect(parseOwnerContentView({ vista: 'tipos' }).tab).toBe('types');
    expect(parseOwnerContentView({ vista: 'publicacoes' }).tab).toBe('posts');
    for (const vista of ['TIPOS', 'xyz', '', ['tipos', 'tipos']]) {
      expect(parseOwnerContentView({ vista } as Params), String(vista)).toEqual(EMPTY);
    }
  });
});

describe('parseOwnerContentView: Por tipo (D-03)', () => {
  it('opens a type only under Por tipo', () => {
    for (const [kind, slug] of Object.entries(CONTENT_KIND_SLUGS)) {
      expect(parseOwnerContentView({ vista: 'tipos', tipo: slug })).toEqual(
        view({ tab: 'types', kind: kind as OwnerContentView['kind'] }),
      );
    }
    expect(CONTENT_KIND_SLUGS).toEqual({
      video: 'video',
      photo: 'foto',
      carousel: 'carrossel',
      text: 'texto',
      link: 'link',
      story: 'story',
    });
    expect(parseOwnerContentView({ tipo: 'video' })).toEqual(EMPTY);
    expect(parseOwnerContentView({ vista: 'publicacoes', tipo: 'video' })).toEqual(
      view({ tab: 'posts' }),
    );
    expect(parseOwnerContentView({ vista: 'tipos', tipo: 'reel' })).toEqual(view({ tab: 'types' }));
  });

  it('opens a publication only of the opened type', () => {
    expect(parseOwnerContentView({ vista: 'tipos', tipo: 'video', post: 'op-11' })).toEqual(
      view({ tab: 'types', kind: 'video', postId: 'op-11' }),
    );
    expect(parseOwnerContentView({ vista: 'tipos', tipo: 'story', post: 'os-01' })).toEqual(
      view({ tab: 'types', kind: 'story', postId: 'os-01' }),
    );
    expect(parseOwnerContentView({ vista: 'tipos', tipo: 'video', post: 'op-15' })).toEqual(
      view({ tab: 'types', kind: 'video' }),
    );
    expect(parseOwnerContentView({ vista: 'tipos', tipo: 'story', post: 'op-11' })).toEqual(
      view({ tab: 'types', kind: 'story' }),
    );
    expect(parseOwnerContentView({ vista: 'tipos', post: 'op-11' })).toEqual(
      view({ tab: 'types' }),
    );
  });
});

describe('parseOwnerContentView: Publicações (D-04) and Visão geral', () => {
  it('opens any feed post, never a story', () => {
    for (const item of POSTS) {
      expect(parseOwnerContentView({ vista: 'publicacoes', post: item.id }).postId).toBe(item.id);
      expect(parseOwnerContentView({ post: item.id }).postId).toBe(item.id);
    }
    expect(parseOwnerContentView({ vista: 'publicacoes', post: 'os-01' }).postId).toBeNull();
    expect(parseOwnerContentView({ post: 'os-01' }).postId).toBeNull();
    for (const post of ['op-99', 'OP-11', ['op-11', 'op-11']]) {
      expect(parseOwnerContentView({ vista: 'publicacoes', post } as Params), String(post)).toEqual(
        view({ tab: 'posts' }),
      );
    }
  });
});

describe('parseOwnerContentView: who did it (D-06, P1, P3)', () => {
  it('opens the four interactions only with a post', () => {
    for (const [who, slug] of Object.entries(CONTENT_WHO_SLUGS)) {
      expect(parseOwnerContentView({ vista: 'publicacoes', post: 'op-11', quem: slug }).who).toBe(
        who,
      );
    }
    expect(parseOwnerContentView({ vista: 'publicacoes', quem: 'curtidas' })).toEqual(
      view({ tab: 'posts' }),
    );
  });

  it('has no views or reach value: those never open people (P3)', () => {
    for (const quem of ['visualizacoes', 'alcance', 'xyz', 'CURTIDAS']) {
      expect(parseOwnerContentView({ vista: 'publicacoes', post: 'op-11', quem }), quem).toEqual(
        view({ tab: 'posts', postId: 'op-11' }),
      );
    }
  });

  it('a story has no saves', () => {
    expect(
      parseOwnerContentView({ vista: 'tipos', tipo: 'story', post: 'os-01', quem: 'salvamentos' }),
    ).toEqual(view({ tab: 'types', kind: 'story', postId: 'os-01' }));
  });

  it('opens a member only from the list that holds them', () => {
    const member = firstLiker('op-11');
    expect(
      parseOwnerContentView({
        vista: 'publicacoes',
        post: 'op-11',
        quem: 'curtidas',
        membro: member,
      }),
    ).toEqual(view({ tab: 'posts', postId: 'op-11', who: 'likes', memberId: member }));
    const outsider = ownerBandRoster.find((row) => !ownerContentIncludes('op-11', 'likes', row.id));
    expect(outsider).toBeDefined();
    expect(
      parseOwnerContentView({
        vista: 'publicacoes',
        post: 'op-11',
        quem: 'curtidas',
        membro: outsider?.id,
      }),
    ).toEqual(view({ tab: 'posts', postId: 'op-11', who: 'likes' }));
    expect(parseOwnerContentView({ vista: 'publicacoes', post: 'op-11', membro: member })).toEqual(
      view({ tab: 'posts', postId: 'op-11' }),
    );
  });

  it('opens a member list only with a member', () => {
    const member = firstLiker('op-11');
    const base = { vista: 'publicacoes', post: 'op-11', quem: 'curtidas', membro: member };
    for (const lista of OWNER_MEMBER_LISTS) {
      expect(parseOwnerContentView({ ...base, lista }).list).toBe(lista);
    }
    expect(parseOwnerContentView({ ...base, lista: 'xyz' }).list).toBeNull();
    expect(
      parseOwnerContentView({ vista: 'publicacoes', post: 'op-11', lista: 'curtidas' }),
    ).toEqual(view({ tab: 'posts', postId: 'op-11' }));
  });
});

describe('parseOwnerContentView: the overview numbers and bands (D-02)', () => {
  it('opens a number only on Visão geral', () => {
    expect(CONTENT_NUMBER_SLUGS).toEqual({
      posts: 'publicacoes',
      interactions: 'interacoes',
      rate: 'taxa',
      members: 'membros',
      views: 'visualizacoes',
      reach: 'alcance',
    });
    for (const [number, slug] of Object.entries(CONTENT_NUMBER_SLUGS)) {
      expect(parseOwnerContentView({ numero: slug })).toEqual(
        view({ number: number as OwnerContentView['number'] }),
      );
    }
    for (const numero of ['xyz', 'MEMBROS', ['taxa', 'taxa']]) {
      expect(parseOwnerContentView({ numero } as Params), String(numero)).toEqual(EMPTY);
    }
    expect(parseOwnerContentView({ vista: 'publicacoes', numero: 'taxa' })).toEqual(
      view({ tab: 'posts' }),
    );
  });

  it('opens a band with interactors only, never with a number', () => {
    expect(parseOwnerContentView({ faixa: 'engajados' })).toEqual(view({ band: 'engaged' }));
    for (const faixa of ['em-risco', 'inativos', 'xyz']) {
      expect(parseOwnerContentView({ faixa }), faixa).toEqual(EMPTY);
    }
    expect(parseOwnerContentView({ numero: 'membros', faixa: 'engajados' })).toEqual(
      view({ number: 'members' }),
    );
    expect(parseOwnerContentView({ vista: 'tipos', faixa: 'engajados' })).toEqual(
      view({ tab: 'types' }),
    );
  });

  it('a number of publications opens any feed post; members and bands take none', () => {
    for (const numero of ['publicacoes', 'interacoes', 'taxa', 'visualizacoes', 'alcance']) {
      expect(parseOwnerContentView({ numero, post: 'op-11' }).postId, numero).toBe('op-11');
      expect(parseOwnerContentView({ numero, post: 'os-01' }).postId, numero).toBeNull();
    }
    expect(parseOwnerContentView({ numero: 'membros', post: 'op-11' })).toEqual(
      view({ number: 'members' }),
    );
    expect(parseOwnerContentView({ faixa: 'engajados', post: 'op-11' })).toEqual(
      view({ band: 'engaged' }),
    );
  });

  it('a member comes from who interacted, or from that band', () => {
    const interactor = firstInteractor(null);
    expect(parseOwnerContentView({ numero: 'membros', membro: interactor })).toEqual(
      view({ number: 'members', memberId: interactor }),
    );
    const atRisk = ownerBandRoster.find((row) => row.band === 'at_risk')?.id;
    expect(parseOwnerContentView({ numero: 'membros', membro: atRisk })).toEqual(
      view({ number: 'members' }),
    );
    const engaged = firstInteractor('engaged');
    expect(parseOwnerContentView({ faixa: 'engajados', membro: engaged })).toEqual(
      view({ band: 'engaged', memberId: engaged }),
    );
    const superfan = firstInteractor('superfan');
    expect(parseOwnerContentView({ faixa: 'engajados', membro: superfan })).toEqual(
      view({ band: 'engaged' }),
    );
    expect(parseOwnerContentView({ numero: 'taxa', membro: interactor })).toEqual(
      view({ number: 'rate' }),
    );
    expect(parseOwnerContentView({ membro: interactor })).toEqual(EMPTY);
    expect(OWNER_BAND_SLUGS.engaged).toBe('engajados');
  });

  it('builds the links and goes back to the number, the band and the card', () => {
    const member = firstInteractor('engaged');
    expect(ownerContentHref(view({ number: 'members', memberId: member }))).toBe(
      `${AREA}&numero=membros&membro=${member}`,
    );
    expect(ownerContentHref(view({ band: 'engaged', memberId: member }))).toBe(
      `${AREA}&faixa=engajados&membro=${member}`,
    );
    expect(contentBackHref(view({ number: 'rate' }))).toBe(`${AREA}#numero-taxa`);
    expect(contentBackHref(view({ number: 'rate', postId: 'op-11' }))).toBe(
      `${AREA}&numero=taxa#post-op-11`,
    );
    expect(contentBackHref(view({ band: 'engaged', memberId: member }))).toBe(
      `${AREA}&faixa=engajados#membro-${member}`,
    );
    expect(contentBackHref(view({ number: 'members', memberId: member }))).toBe(
      `${AREA}&numero=membros#membro-${member}`,
    );
    // Quick 261013-uoi F-7: on Visão geral, a post that needs attention has no `post-` card, so its
    // detail goes back to its attention row; a top post keeps its card.
    expect(contentBackHref(view({ postId: 'op-19' }))).toBe(`${AREA}#atencao-op-19`);
    expect(contentBackHref(view({ postId: 'op-41' }))).toBe(`${AREA}#post-op-41`);
    expect(contentBackHref(view({ tab: 'posts', postId: 'op-19' }))).toBe(
      `${AREA}&vista=publicacoes#post-op-19`,
    );
    expect(contentBackHref(view({ reply: 'op-19' }))).toBe(`${AREA}#atencao-op-19`);
    expect(contentBackHref(view({ band: 'engaged' }))).toBeNull();
  });
});

describe('ownerContentHref and contentBackHref', () => {
  it('builds the tabs and the params in order', () => {
    expect(ownerContentHref(EMPTY)).toBe(AREA);
    expect(ownerContentHref(view({ tab: 'types' }))).toBe(`${AREA}&vista=tipos`);
    expect(ownerContentHref(view({ tab: 'posts' }))).toBe(`${AREA}&vista=publicacoes`);
    expect(ownerContentHref(view({ tab: 'types', kind: 'carousel', postId: 'op-15' }))).toBe(
      `${AREA}&vista=tipos&tipo=carrossel&post=op-15`,
    );
    const member = firstLiker('op-11');
    expect(
      ownerContentHref(
        view({ tab: 'posts', postId: 'op-11', who: 'likes', memberId: member, list: 'curtidas' }),
      ),
    ).toBe(`${AREA}&vista=publicacoes&post=op-11&quem=curtidas&membro=${member}&lista=curtidas`);
  });

  it('goes back one level, landing on what was closed', () => {
    const member = firstLiker('op-11');
    const list = view({
      tab: 'posts',
      postId: 'op-11',
      who: 'likes',
      memberId: member,
      list: 'curtidas',
    });
    expect(contentBackHref(list)).toBe(
      `${AREA}&vista=publicacoes&post=op-11&quem=curtidas&membro=${member}#insight-curtidas`,
    );
    expect(contentBackHref({ ...list, list: null })).toBe(
      `${AREA}&vista=publicacoes&post=op-11&quem=curtidas#membro-${member}`,
    );
    expect(contentBackHref({ ...list, list: null, memberId: null })).toBe(
      `${AREA}&vista=publicacoes&post=op-11#quem-curtidas`,
    );
    expect(contentBackHref(view({ tab: 'posts', postId: 'op-11' }))).toBe(
      `${AREA}&vista=publicacoes#post-op-11`,
    );
    expect(contentBackHref(view({ tab: 'types', kind: 'video', postId: 'op-11' }))).toBe(
      `${AREA}&vista=tipos&tipo=video#post-op-11`,
    );
    expect(contentBackHref(view({ tab: 'types', kind: 'story' }))).toBe(
      `${AREA}&vista=tipos#tipo-story`,
    );
    expect(contentBackHref(view({ tab: 'types' }))).toBeNull();
    expect(contentBackHref(EMPTY)).toBeNull();
  });

  it('round-trips every valid level (parse of the href is the view)', () => {
    const views: OwnerContentView[] = [EMPTY, view({ tab: 'types' }), view({ tab: 'posts' })];
    for (const kind of Object.keys(CONTENT_KIND_SLUGS) as NonNullable<OwnerContentView['kind']>[]) {
      views.push(view({ tab: 'types', kind }));
    }
    const withPost = (base: OwnerContentView, item: ContentItem) => {
      views.push({ ...base, postId: item.id });
      for (const who of Object.keys(CONTENT_WHO_SLUGS) as NonNullable<OwnerContentView['who']>[]) {
        if (who === 'saves' && item.saves === null) continue;
        views.push({ ...base, postId: item.id, who });
        const member = firstIn(item.id, who);
        if (!member) continue;
        views.push({ ...base, postId: item.id, who, memberId: member });
        for (const list of OWNER_MEMBER_LISTS) {
          views.push({ ...base, postId: item.id, who, memberId: member, list });
        }
      }
    };
    for (const item of ownerContentItems) {
      withPost(view({ tab: 'types', kind: item.kind }), item);
      if (item.kind !== 'story') {
        withPost(view({ tab: 'posts' }), item);
        withPost(EMPTY, item);
      }
    }
    for (const number of Object.keys(CONTENT_NUMBER_SLUGS) as NonNullable<
      OwnerContentView['number']
    >[]) {
      views.push(view({ number }));
      if (number === 'members') {
        const member = firstInteractor(null);
        views.push(view({ number, memberId: member }));
        for (const list of OWNER_MEMBER_LISTS) views.push(view({ number, memberId: member, list }));
      } else {
        withPost(view({ number }), ownerContentItems[0] as ContentItem);
      }
    }
    for (const band of ['new', 'superfan', 'engaged', 'occasional'] as const) {
      views.push(view({ band }));
      const member = firstInteractor(band);
      views.push(view({ band, memberId: member }));
      views.push(view({ band, memberId: member, list: 'curtidas' }));
    }
    for (const expected of views) {
      expect(parseOwnerContentView(paramsOf(ownerContentHref(expected)))).toEqual(expected);
      const back = contentBackHref(expected);
      if (back !== null) expect(back.startsWith(AREA)).toBe(true);
    }
  });
});

describe('the unanswered comments screen (quick 261013-orf E-02, E-03.10)', () => {
  it('needs attention only past 24 hours without an answer', () => {
    expect(
      ownerContentItems
        .filter(needsAttention)
        .map((item) => item.id)
        .sort(),
    ).toEqual(['op-08', 'op-12', 'op-19', 'op-24']);
  });

  it('opens `responder` alone on Visão geral, for a post that needs attention', () => {
    expect(parseOwnerContentView({ responder: 'op-24' })).toEqual(view({ reply: 'op-24' }));
    for (const params of [
      { responder: 'op-11' },
      { responder: 'xyz' },
      { responder: ['op-24', 'op-24'] },
      { numero: 'interacoes', responder: 'op-24' },
      { faixa: 'superfas', responder: 'op-24' },
      { vista: 'tipos', responder: 'op-24' },
      { vista: 'publicacoes', responder: 'op-24' },
    ]) {
      expect(parseOwnerContentView(params).reply, JSON.stringify(params)).toBeNull();
    }
    expect(parseOwnerContentView({ responder: 'op-24', post: 'op-11', quem: 'curtidas' })).toEqual(
      view({ reply: 'op-24' }),
    );
  });

  it('builds its link, goes back to the attention row and round-trips', () => {
    const reply = view({ reply: 'op-24' });
    expect(ownerContentHref(reply)).toBe(`${AREA}&responder=op-24`);
    expect(contentBackHref(reply)).toBe(`${AREA}#atencao-op-24`);
    expect(contentAttentionAnchor('op-24')).toBe('atencao-op-24');
    expect(parseOwnerContentView(paramsOf(ownerContentHref(reply)))).toEqual(reply);
  });
});

describe('contentCoverRatio (PD-2, the feed ratios)', () => {
  const item = (kind: ContentItem['kind'], media: ContentItem['media']) => ({ kind, media });

  it('clamps a video to [9:16, 1.91] with the 4:5 fallback', () => {
    expect(contentCoverRatio(item('video', { width: 1080, height: 1920 }))).toBeCloseTo(0.5625);
    expect(contentCoverRatio(item('video', { width: 1920, height: 1080 }))).toBeCloseTo(16 / 9);
    expect(contentCoverRatio(item('video', { width: 900, height: 2100 }))).toBeCloseTo(9 / 16);
    expect(contentCoverRatio(item('video', { width: 3000, height: 1000 }))).toBeCloseTo(1.91);
    expect(contentCoverRatio(item('video', null))).toBeCloseTo(0.8);
  });

  it('clamps a photo or a carousel to [4:5, 1.91] with the square fallback', () => {
    expect(contentCoverRatio(item('photo', { width: 1080, height: 1350 }))).toBeCloseTo(0.8);
    expect(contentCoverRatio(item('photo', { width: 1080, height: 2400 }))).toBeCloseTo(0.8);
    expect(contentCoverRatio(item('carousel', { width: 1080, height: 1080 }))).toBeCloseTo(1);
    expect(contentCoverRatio(item('carousel', null))).toBeCloseTo(1);
  });

  it('draws a link at 16:9, a story at 9:16 and no cover for text', () => {
    expect(contentCoverRatio(item('link', null))).toBeCloseTo(16 / 9);
    expect(contentCoverRatio(item('story', { width: 1080, height: 1920 }))).toBeCloseTo(9 / 16);
    expect(contentCoverRatio(item('text', null))).toBeNull();
  });
});

describe('contentRecommendation (the deterministic rule of D-06)', () => {
  const base = { kind: 'video' as const, kindAverage: 96, daysAgo: 10, durationSeconds: 1500 };

  it('pushes a publication still in its first 48 hours', () => {
    expect(contentRecommendation({ ...base, interactions: 500, daysAgo: 1 })).toBe('push');
  });

  it('turns a publication 1,5× its kind into a series', () => {
    expect(contentRecommendation({ ...base, interactions: 144 })).toBe('series');
  });

  it('pushes a story or a short video', () => {
    expect(
      contentRecommendation({ ...base, kind: 'story', interactions: 30, durationSeconds: null }),
    ).toBe('push');
    expect(contentRecommendation({ ...base, interactions: 100, durationSeconds: 58 })).toBe('push');
  });

  it('turns anything else into a reel', () => {
    expect(contentRecommendation({ ...base, interactions: 100 })).toBe('reel');
    expect(
      contentRecommendation({ ...base, kind: 'text', interactions: 40, kindAverage: 48 }),
    ).toBe('reel');
  });
});
