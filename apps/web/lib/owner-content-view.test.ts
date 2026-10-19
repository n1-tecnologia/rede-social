import { describe, expect, it } from 'vitest';
import { OWNER_MEASURED_LISTS, type OwnerMeasuredListSlug } from './owner-band-scope';
import {
  CONTENT_ATTENTION_ANCHOR,
  CONTENT_KIND_SLUGS,
  CONTENT_NUMBER_SLUGS,
  CONTENT_WHO_SLUGS,
  contentBackHref,
  contentCoverRatio,
  contentRecommendation,
  needsAttention,
  type OwnerContentView,
  ownerContentHref,
  parseOwnerContentView,
} from './owner-content-view';

/*
 * The Conteúdo URL (08.7-07, R-Pitfall 7): SYNTACTIC. Tabs, kinds, numbers and people are slugs,
 * a publication and a member are uuids; whether an id is the tenant's and sits in the opened list is
 * the API's to say (its 404 falls back to the list). No fixture is read.
 */

type Params = Parameters<typeof parseOwnerContentView>[0];

const AREA = '/perfil?area=conteudo';
const POST = '0b6c4f1e-5d2a-4c3b-9a8e-1f2d3c4b5a69';
const STORY = '7e1d2c3b-4a59-4687-8796-a5b4c3d2e1f0';
const MEMBER = '3c2b1a09-8f7e-4d6c-9b5a-4a39281706f5';

const EMPTY: OwnerContentView = {
  tab: 'overview',
  number: null,
  kind: null,
  postId: null,
  who: null,
  memberId: null,
  list: null,
  replies: false,
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

const MEASURED = Object.keys(OWNER_MEASURED_LISTS) as OwnerMeasuredListSlug[];

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

  it('with feed off only Por tipo remains (UI-D-473: the stories)', () => {
    const storiesOnly = { feed: false, stories: true };
    expect(parseOwnerContentView({}, storiesOnly)).toEqual(view({ tab: 'types' }));
    expect(parseOwnerContentView({ vista: 'publicacoes' }, storiesOnly)).toEqual(
      view({ tab: 'types' }),
    );
    expect(parseOwnerContentView({ numero: 'interacoes' }, storiesOnly)).toEqual(
      view({ tab: 'types' }),
    );
  });
});

describe('parseOwnerContentView: Por tipo (D-03, UI-D-473)', () => {
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

  it('drops a kind whose module is off, with no notice', () => {
    expect(
      parseOwnerContentView({ vista: 'tipos', tipo: 'story' }, { feed: true, stories: false }),
    ).toEqual(view({ tab: 'types' }));
    expect(
      parseOwnerContentView({ vista: 'tipos', tipo: 'video' }, { feed: false, stories: true }),
    ).toEqual(view({ tab: 'types' }));
    expect(
      parseOwnerContentView({ vista: 'tipos', tipo: 'story' }, { feed: false, stories: true }),
    ).toEqual(view({ tab: 'types', kind: 'story' }));
  });

  it('opens a publication (a uuid) only inside an opened type', () => {
    expect(parseOwnerContentView({ vista: 'tipos', tipo: 'video', post: POST })).toEqual(
      view({ tab: 'types', kind: 'video', postId: POST }),
    );
    expect(parseOwnerContentView({ vista: 'tipos', tipo: 'story', post: STORY })).toEqual(
      view({ tab: 'types', kind: 'story', postId: STORY }),
    );
    expect(parseOwnerContentView({ vista: 'tipos', post: POST })).toEqual(view({ tab: 'types' }));
  });
});

describe('parseOwnerContentView: a publication is a uuid (R-Pitfall 7)', () => {
  it('opens any uuid under Publicações and Visão geral', () => {
    expect(parseOwnerContentView({ vista: 'publicacoes', post: POST })).toEqual(
      view({ tab: 'posts', postId: POST }),
    );
    expect(parseOwnerContentView({ post: POST })).toEqual(view({ postId: POST }));
  });

  it('a non-uuid post opens nothing', () => {
    for (const post of ['op-11', 'xyz', '', POST.toUpperCase().replace(/-/g, ''), [POST, POST]]) {
      expect(parseOwnerContentView({ vista: 'publicacoes', post } as Params), String(post)).toEqual(
        view({ tab: 'posts' }),
      );
      expect(parseOwnerContentView({ post } as Params), String(post)).toEqual(EMPTY);
    }
  });
});

describe('parseOwnerContentView: who did it (D-06, D-455, P3)', () => {
  it('opens likes and comments only with a post', () => {
    expect(CONTENT_WHO_SLUGS).toEqual({ likes: 'curtidas', comments: 'comentarios' });
    for (const [who, slug] of Object.entries(CONTENT_WHO_SLUGS)) {
      expect(parseOwnerContentView({ vista: 'publicacoes', post: POST, quem: slug }).who).toBe(who);
    }
    expect(parseOwnerContentView({ vista: 'publicacoes', quem: 'curtidas' })).toEqual(
      view({ tab: 'posts' }),
    );
  });

  it('a typed saves, shares, views or reach falls one level up with no notice', () => {
    for (const quem of [
      'salvamentos',
      'compartilhamentos',
      'visualizacoes',
      'alcance',
      'CURTIDAS',
    ]) {
      expect(parseOwnerContentView({ vista: 'publicacoes', post: POST, quem }), quem).toEqual(
        view({ tab: 'posts', postId: POST }),
      );
    }
  });

  it('opens a member (a uuid) only from a people list, and a list only with a member', () => {
    const people = { vista: 'publicacoes', post: POST, quem: 'curtidas', membro: MEMBER };
    expect(parseOwnerContentView(people)).toEqual(
      view({ tab: 'posts', postId: POST, who: 'likes', memberId: MEMBER }),
    );
    expect(parseOwnerContentView({ ...people, membro: 'm-01' })).toEqual(
      view({ tab: 'posts', postId: POST, who: 'likes' }),
    );
    expect(parseOwnerContentView({ vista: 'publicacoes', post: POST, membro: MEMBER })).toEqual(
      view({ tab: 'posts', postId: POST }),
    );
    for (const lista of MEASURED) {
      expect(parseOwnerContentView({ ...people, lista }).list).toBe(lista);
    }
    for (const lista of ['posts-vistos', 'xyz']) {
      expect(parseOwnerContentView({ ...people, lista }).list, lista).toBeNull();
    }
  });
});

describe('parseOwnerContentView: the overview numbers (D-02, D-455)', () => {
  it('opens the two measured lists only on Visão geral', () => {
    expect(CONTENT_NUMBER_SLUGS).toEqual({ posts: 'publicacoes', interactions: 'interacoes' });
    expect(parseOwnerContentView({ numero: 'publicacoes' })).toEqual(view({ number: 'posts' }));
    expect(parseOwnerContentView({ numero: 'interacoes' })).toEqual(
      view({ number: 'interactions' }),
    );
    expect(parseOwnerContentView({ vista: 'publicacoes', numero: 'interacoes' })).toEqual(
      view({ tab: 'posts' }),
    );
  });

  it('a typed Em breve number (taxa, visualizacoes, alcance) falls to the overview', () => {
    for (const numero of ['taxa', 'visualizacoes', 'alcance', 'membros', 'xyz', ['taxa']]) {
      expect(parseOwnerContentView({ numero } as Params), String(numero)).toEqual(EMPTY);
    }
    expect(parseOwnerContentView({ numero: 'taxa', post: POST })).toEqual(view({ postId: POST }));
  });

  it('the publications number opens a post; the interactions number opens a member', () => {
    expect(parseOwnerContentView({ numero: 'publicacoes', post: POST })).toEqual(
      view({ number: 'posts', postId: POST }),
    );
    expect(parseOwnerContentView({ numero: 'interacoes', post: POST })).toEqual(
      view({ number: 'interactions' }),
    );
    expect(parseOwnerContentView({ numero: 'interacoes', membro: MEMBER })).toEqual(
      view({ number: 'interactions', memberId: MEMBER }),
    );
    expect(parseOwnerContentView({ numero: 'interacoes', membro: MEMBER, lista: 'curtidas' })).toEqual(
      view({ number: 'interactions', memberId: MEMBER, list: 'curtidas' }),
    );
    expect(parseOwnerContentView({ numero: 'publicacoes', membro: MEMBER })).toEqual(
      view({ number: 'posts' }),
    );
    expect(parseOwnerContentView({ membro: MEMBER })).toEqual(EMPTY);
  });

  it('there is no band of interactors to open (no list behind it)', () => {
    expect(parseOwnerContentView({ faixa: 'engajados' })).toEqual(EMPTY);
  });
});

describe('the unanswered comments screen (D-461, UI-D-489 b)', () => {
  it('opens alone on Visão geral, with every deeper param ignored', () => {
    expect(parseOwnerContentView({ responder: 'comentarios' })).toEqual(view({ replies: true }));
    expect(
      parseOwnerContentView({ responder: 'comentarios', post: POST, quem: 'curtidas' }),
    ).toEqual(view({ replies: true }));
    for (const params of [
      { responder: POST },
      { responder: 'xyz' },
      { responder: ['comentarios', 'comentarios'] },
      { numero: 'interacoes', responder: 'comentarios' },
      { vista: 'tipos', responder: 'comentarios' },
      { vista: 'publicacoes', responder: 'comentarios' },
    ]) {
      expect(parseOwnerContentView(params as Params).replies, JSON.stringify(params)).toBe(false);
    }
  });

  it('builds its link, goes back to "Precisa de atenção" and round-trips', () => {
    const replies = view({ replies: true });
    expect(ownerContentHref(replies)).toBe(`${AREA}&responder=comentarios`);
    expect(contentBackHref(replies)).toBe(`${AREA}#${CONTENT_ATTENTION_ANCHOR}`);
    expect(parseOwnerContentView(paramsOf(ownerContentHref(replies)))).toEqual(replies);
  });

  it('needs attention: a post with a comment unanswered for over 24 hours, never a story', () => {
    const meta = (hours: number | null) => ({
      answered: 0,
      unanswered: hours === null ? 0 : 1,
      oldestUnansweredHours: hours,
      firstReplyMedianMinutes: null,
    });
    expect(needsAttention({ kind: 'video', commentMeta: meta(25) })).toBe(true);
    expect(needsAttention({ kind: 'video', commentMeta: meta(24) })).toBe(false);
    expect(needsAttention({ kind: 'text', commentMeta: meta(null) })).toBe(false);
    expect(needsAttention({ kind: 'story' })).toBe(false);
  });
});

describe('ownerContentHref and contentBackHref', () => {
  it('builds the tabs and the params in order', () => {
    expect(ownerContentHref(EMPTY)).toBe(AREA);
    expect(ownerContentHref(view({ tab: 'types' }))).toBe(`${AREA}&vista=tipos`);
    expect(ownerContentHref(view({ tab: 'posts' }))).toBe(`${AREA}&vista=publicacoes`);
    expect(ownerContentHref(view({ tab: 'types', kind: 'carousel', postId: POST }))).toBe(
      `${AREA}&vista=tipos&tipo=carrossel&post=${POST}`,
    );
    expect(
      ownerContentHref(
        view({ tab: 'posts', postId: POST, who: 'likes', memberId: MEMBER, list: 'curtidas' }),
      ),
    ).toBe(`${AREA}&vista=publicacoes&post=${POST}&quem=curtidas&membro=${MEMBER}&lista=curtidas`);
  });

  it('goes back one level, landing on what was closed', () => {
    const list = view({
      tab: 'posts',
      postId: POST,
      who: 'likes',
      memberId: MEMBER,
      list: 'curtidas',
    });
    expect(contentBackHref(list)).toBe(
      `${AREA}&vista=publicacoes&post=${POST}&quem=curtidas&membro=${MEMBER}#insight-curtidas`,
    );
    expect(contentBackHref({ ...list, list: null })).toBe(
      `${AREA}&vista=publicacoes&post=${POST}&quem=curtidas#membro-${MEMBER}`,
    );
    expect(contentBackHref({ ...list, list: null, memberId: null })).toBe(
      `${AREA}&vista=publicacoes&post=${POST}#quem-curtidas`,
    );
    expect(contentBackHref(view({ tab: 'posts', postId: POST }))).toBe(
      `${AREA}&vista=publicacoes#post-${POST}`,
    );
    expect(contentBackHref(view({ postId: POST }))).toBe(`${AREA}#post-${POST}`);
    expect(contentBackHref(view({ tab: 'types', kind: 'video', postId: POST }))).toBe(
      `${AREA}&vista=tipos&tipo=video#post-${POST}`,
    );
    expect(contentBackHref(view({ tab: 'types', kind: 'story' }))).toBe(
      `${AREA}&vista=tipos#tipo-story`,
    );
    expect(contentBackHref(view({ number: 'interactions', memberId: MEMBER }))).toBe(
      `${AREA}&numero=interacoes#membro-${MEMBER}`,
    );
    expect(contentBackHref(view({ number: 'posts' }))).toBe(`${AREA}#numero-publicacoes`);
    expect(contentBackHref(view({ tab: 'types' }))).toBeNull();
    expect(contentBackHref(EMPTY)).toBeNull();
  });

  it('round-trips every valid level (parse of the href is the view)', () => {
    const views: OwnerContentView[] = [EMPTY, view({ tab: 'types' }), view({ tab: 'posts' })];
    const withPost = (base: OwnerContentView) => {
      views.push({ ...base, postId: POST });
      for (const who of Object.keys(CONTENT_WHO_SLUGS) as NonNullable<OwnerContentView['who']>[]) {
        views.push({ ...base, postId: POST, who });
        views.push({ ...base, postId: POST, who, memberId: MEMBER });
        for (const list of MEASURED) {
          views.push({ ...base, postId: POST, who, memberId: MEMBER, list });
        }
      }
    };
    for (const kind of Object.keys(CONTENT_KIND_SLUGS) as NonNullable<OwnerContentView['kind']>[]) {
      views.push(view({ tab: 'types', kind }));
      withPost(view({ tab: 'types', kind }));
    }
    withPost(view({ tab: 'posts' }));
    withPost(EMPTY);
    views.push(view({ number: 'posts' }));
    withPost(view({ number: 'posts' }));
    views.push(view({ number: 'interactions' }));
    views.push(view({ number: 'interactions', memberId: MEMBER }));
    for (const list of MEASURED) {
      views.push(view({ number: 'interactions', memberId: MEMBER, list }));
    }
    views.push(view({ replies: true }));
    for (const expected of views) {
      expect(parseOwnerContentView(paramsOf(ownerContentHref(expected)))).toEqual(expected);
      const back = contentBackHref(expected);
      if (back !== null) expect(back.startsWith(AREA)).toBe(true);
    }
  });
});

describe('contentCoverRatio (PD-2, the feed ratios)', () => {
  type Media = { width: number; height: number } | null;
  const item = (kind: NonNullable<OwnerContentView['kind']>, media: Media) => ({ kind, media });

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
