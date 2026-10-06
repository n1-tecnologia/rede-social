import type { HighlightSummary, StorySummary } from '@rede-social/module-stories/contracts';
import { STORY_MAX_PAGE_SIZE } from '@rede-social/module-stories/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import {
  highlightCircleView,
  highlightEditStoryView,
  highlightGroupView,
  highlightManageRowView,
  highlightPlacesView,
  inicioGroups,
  inicioRow,
  monogramOf,
  type StoryViewerItemView,
  storyHistoryView,
  storyViewerItem,
  storyViewerLabels,
  tenantCircleFace,
  tenantCircleView,
  tenantGroupView,
  tenantSeenState,
  tenantSequence,
} from '@/lib/story-view';

/**
 * The Início row's view builders (HIGHLIGHT-03, D-104, D-106, UI-D-59..UI-D-62), asserted against
 * the REAL pt-BR catalog so a missing key or a reworded string turns this file red.
 *
 * The claims worth a test are the ones a later edit could quietly break:
 *
 *  1. **D-106's reversal of ONE bounded page.** `GET /v1/stories` answers newest first and keeps its
 *     index-only plan; the web plays the tenant circle OLDEST → NEWEST by reversing the page it read,
 *     and never more than `STORY_MAX_PAGE_SIZE` of it (the newest 25).
 *  2. **The disc fallbacks** (UI-D-60, UI-D-62): no logo → the display name's monogram; no cover →
 *     the title's monogram. Both take the first GRAPHEME, trimmed, upper-cased.
 *  3. **UI-D-59's composition and render rule**: `+` (permission-gated) → tenant (iff something is
 *     live) → highlights in the API's order; a member with nothing gets NO circle at all.
 *  4. **05.2-05: every openable circle IS a viewer group, in the same order** (D-107, UI-D-65). The
 *     tenant circle opens group 0 and highlight circle k opens the group right after the ones before
 *     it — so the circles and the groups the viewer walks can never disagree. A highlight group
 *     carries NO items (they load lazily, never in `/inicio`'s SSR).
 */

// The catalog is loaded at runtime, so next-intl cannot type its keys here; the translator is cast
// to the plain reader signature the builders take.
const t = createTranslator({
  locale: 'pt-BR',
  messages: loadMessages(),
  namespace: 'stories',
} as never) as unknown as (key: string, values?: Record<string, string | number>) => string;

function highlight(overrides: Partial<HighlightSummary> = {}): HighlightSummary {
  return {
    id: '0000000a-1111-4111-8111-111111111111',
    communityId: null,
    title: 'Bastidores',
    position: 0,
    coverAssetId: '0000000b-1111-4111-8111-111111111111',
    coverVariantWidths: [640, 1080],
    coverStoryId: null,
    coverChosen: false,
    itemCount: 2,
    ...overrides,
  };
}

describe('tenantSequence — one bounded page, played oldest first (D-106)', () => {
  it('1. reverses the API page so the FIRST element is the oldest story', () => {
    const page = { items: [{ id: 'newest' }, { id: 'middle' }, { id: 'oldest' }] };
    expect(tenantSequence(page).map((s) => s.id)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('2. of 30 items it keeps the newest 25 (the API order’s first 25), then reverses them', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}` })); // s0 is the newest
    const sequence = tenantSequence({ items });
    expect(sequence).toHaveLength(STORY_MAX_PAGE_SIZE);
    expect(sequence[0]?.id).toBe('s24');
    expect(sequence.at(-1)?.id).toBe('s0');
  });

  it('3. a missing page (a failed read) or an empty one is an empty sequence', () => {
    expect(tenantSequence(null)).toEqual([]);
    expect(tenantSequence({ items: [] })).toEqual([]);
  });

  it('4. never mutates the page it was handed', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    tenantSequence({ items });
    expect(items.map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('monogramOf — the first grapheme, trimmed, upper-cased (UI-D-60, UI-D-62)', () => {
  it('5. "  ábaco" is "Á"', () => {
    expect(monogramOf('  ábaco')).toBe('Á');
  });

  it('6. an empty or blank text is the empty string (the gradient disc with no letter)', () => {
    expect(monogramOf('')).toBe('');
    expect(monogramOf('   ')).toBe('');
  });

  it('7. a joined family emoji stays ONE grapheme', () => {
    const family = '\u{1F469}‍\u{1F469}‍\u{1F467}';
    expect(monogramOf(`${family} grupo`)).toBe(family);
  });
});

describe('tenantCircleView — the tenant circle (D-104, UI-D-60, UI-D-61)', () => {
  it('8. with a logo: a logo disc, the display name as label, "Abrir stories de {tenant}"', () => {
    // 05.2-10: the seen state is an input now; "all seen" is the plain name (see case 32).
    const circle = tenantCircleView({ displayName: 'Demo', logoUrl: '/logo.png' }, t, {
      anyUnseen: false,
      resumeIndex: 0,
    });
    expect(circle).toMatchObject({
      kind: 'open',
      key: 'tenant',
      label: 'Demo',
      actionLabel: 'Abrir stories de Demo',
      ring: 'neutral',
      disc: { kind: 'logo', src: '/logo.png' },
      group: 0,
      index: 0,
    });
  });

  it('9. without a logo: the monogram of the display name', () => {
    const circle = tenantCircleView({ displayName: 'édson escola', logoUrl: null }, t, {
      anyUnseen: true,
      resumeIndex: 0,
    });
    expect(circle.disc).toEqual({ kind: 'monogram', text: 'É' });
    expect(circle.label).toBe('édson escola');
  });
});

describe('highlightCircleView — one highlight circle (UI-D-61, UI-D-62)', () => {
  it('10. with a resolved cover: an asset disc, the title as label, "Abrir destaque {title}", neutral', () => {
    const circle = highlightCircleView(highlight(), t, 1);
    expect(circle).toMatchObject({
      key: '0000000a-1111-4111-8111-111111111111',
      label: 'Bastidores',
      actionLabel: 'Abrir destaque Bastidores',
      ring: 'neutral',
      disc: {
        kind: 'asset',
        assetId: '0000000b-1111-4111-8111-111111111111',
        variantWidths: [640, 1080],
      },
    });
  });

  it('11. with no resolvable cover (video-only, cover deleted): the monogram of the title', () => {
    const circle = highlightCircleView(highlight({ coverAssetId: null, title: 'aulas' }), t, 1);
    expect(circle.disc).toEqual({ kind: 'monogram', text: 'A' });
    expect(circle.ring).toBe('neutral');
  });

  it('12. is an OPENER of its own viewer group (05.2-05), never a link', () => {
    expect(highlightCircleView(highlight(), t, 3)).toMatchObject({
      kind: 'open',
      group: 3,
      index: 0,
    });
  });
});

describe('inicioRow — UI-D-59 order and the all-or-nothing render rule', () => {
  const tenant = { displayName: 'Demo', logoUrl: null };

  it('13. an admin with live stories and highlights: + , tenant, highlights in API order', () => {
    const row = inicioRow(
      {
        canPublish: true,
        tenant,
        sequenceLength: 3,
        highlights: [
          highlight({ id: '0000000c-1111-4111-8111-111111111111', title: 'Segundo' }),
          highlight({ title: 'Primeiro' }),
        ],
      },
      t,
    );
    expect(row.map((c) => c.label)).toEqual(['Seu story', 'Demo', 'Segundo', 'Primeiro']);
    // UI-D-28 as amended (2026-10-02): the centred Plus in the dashed "only you see this" ring
    // (UI-D-63), the manage circle's language, with nothing of the admin's profile in it.
    expect(row[0]).toEqual({
      kind: 'link',
      key: 'own',
      href: '/stories/publicar',
      label: 'Seu story',
      actionLabel: 'Publicar um story',
      ring: 'dashed',
      disc: { kind: 'own' },
    });
    expect(row[1]).toMatchObject({ kind: 'open', ring: 'brand', group: 0, index: 0 });
    // Each highlight opens the group right after the tenant's, in row order.
    expect(row[2]).toMatchObject({ kind: 'open', group: 1, index: 0 });
    expect(row[3]).toMatchObject({ kind: 'open', group: 2, index: 0 });
  });

  it('14. a member never gets the + circle', () => {
    const row = inicioRow({ canPublish: false, tenant, sequenceLength: 1, highlights: [] }, t);
    expect(row.map((c) => c.label)).toEqual(['Demo']);
  });

  it('15. nothing live → no tenant circle; the highlights still render (UI-D-59, partial E01)', () => {
    const row = inicioRow(
      { canPublish: false, tenant, sequenceLength: 0, highlights: [highlight()] },
      t,
    );
    expect(row.map((c) => c.label)).toEqual(['Bastidores']);
    // With no tenant group in front of it, the first highlight IS group 0.
    expect(row[0]).toMatchObject({ kind: 'open', group: 0, index: 0 });
  });

  it('16. a member with nothing gets NO circle at all (UI-D-26)', () => {
    expect(inicioRow({ canPublish: false, tenant, sequenceLength: 0, highlights: [] }, t)).toEqual(
      [],
    );
  });

  it('17. an admin with nothing still gets the + circle alone (D-108)', () => {
    const row = inicioRow({ canPublish: true, tenant, sequenceLength: 0, highlights: [] }, t);
    expect(row.map((c) => c.kind)).toEqual(['link']);
    expect(row[0]).toMatchObject({ ring: 'dashed', disc: { kind: 'own' } });
  });
});

/* ── 05.2-05: the viewer's groups (D-107, UI-D-65, R-P6) ─────────────────────────────────────── */

function viewerItem(id: string): StoryViewerItemView {
  return {
    id,
    mediaKind: 'image',
    mediaAssetId: '0000000d-1111-4111-8111-111111111111',
    mediaVariantWidths: [640],
    caption: '',
    timeLabel: 'há 1 h',
    likeCount: 0,
    commentCount: 0,
    viewerLiked: false,
    seen: false,
    authorAvatarUrl: null,
  };
}

describe('the viewer groups — one per openable circle, in row order (05.2-05)', () => {
  it('18. tenantGroupView: the tenant name and logo head the group, which carries its sequence', () => {
    const items = [viewerItem('a'), viewerItem('b')];
    expect(tenantGroupView({ displayName: 'Demo', logoUrl: '/logo.png' }, items)).toEqual({
      key: 'tenant',
      kind: 'tenant',
      highlightId: null,
      name: 'Demo',
      avatar: { kind: 'avatar', src: '/logo.png' },
      items,
    });
  });

  it('19. highlightGroupView: the title and cover head the group, and its items are NOT loaded', () => {
    expect(highlightGroupView(highlight())).toEqual({
      key: '0000000a-1111-4111-8111-111111111111',
      kind: 'highlight',
      highlightId: '0000000a-1111-4111-8111-111111111111',
      name: 'Bastidores',
      avatar: {
        kind: 'asset',
        assetId: '0000000b-1111-4111-8111-111111111111',
        variantWidths: [640, 1080],
      },
      items: null,
    });
    // No resolvable cover: the title's monogram, the circle's own fallback (UI-D-62).
    expect(highlightGroupView(highlight({ coverAssetId: null, title: 'aulas' })).avatar).toEqual({
      kind: 'monogram',
      text: 'A',
    });
  });

  it('20. inicioGroups: [tenant (items), highlight 1 (null), highlight 2 (null)] — the circles’ order', () => {
    const tenant = { displayName: 'Demo', logoUrl: null };
    const second = highlight({ id: '0000000c-1111-4111-8111-111111111111', title: 'Segundo' });
    const groups = inicioGroups({
      tenant,
      sequence: [viewerItem('a')],
      highlightGroups: [highlight(), second].map(highlightGroupView),
    });
    expect(groups.map((g) => [g.kind, g.name, g.items === null])).toEqual([
      ['tenant', 'Demo', false],
      ['highlight', 'Bastidores', true],
      ['highlight', 'Segundo', true],
    ]);

    // …and the row agrees, circle for group: the viewer opens where the circle says.
    const row = inicioRow(
      {
        canPublish: false,
        tenant,
        sequenceLength: 1,
        highlights: [highlight(), second],
      },
      t,
    );
    expect(row.map((c) => (c.kind === 'open' ? groups[c.group]?.name : null))).toEqual([
      'Demo',
      'Bastidores',
      'Segundo',
    ]);
  });

  it('21. with nothing live the groups are the highlights alone — no empty tenant group', () => {
    const groups = inicioGroups({
      tenant: { displayName: 'Demo', logoUrl: null },
      sequence: [],
      highlightGroups: [highlight()].map(highlightGroupView),
    });
    expect(groups.map((g) => g.kind)).toEqual(['highlight']);
  });

  it('22. the viewer labels carry the group template raw, the loading line and the group error', () => {
    const labels = storyViewerLabels(
      Object.assign(t, {
        raw: (key: string) =>
          key
            .split('.')
            .reduce<unknown>(
              (node, part) => (node as Record<string, unknown>)?.[part],
              (loadMessages() as { stories: unknown }).stories,
            ),
      }),
    );
    expect(labels.positionGroup).toBe('{group}: story {current} de {total}');
    expect(labels.loadingGroup).toBe('Carregando destaque…');
    expect(labels.groupError).toBe('Não foi possível carregar este destaque.');
  });
});

/**
 * 05.2-06 — the highlight sheet's place groups (D-110, UI-D-67, UI E09 partial / zero-one-many).
 *
 * The catalogue answers Início first and then each community's highlights in the community's own
 * `position` order; the SHEET groups them by place in the communities LIST order (the order the
 * member sees communities everywhere else), labels each group with the place's name, and drops what
 * a curator cannot act on: a highlight whose community is not in the active list (archived, or the
 * communities module off). A place with no highlight has no group — unless the caller is the
 * composer's single-select sheet (plan 08), which asks for every place so each can end with its own
 * "Novo destaque".
 */
describe('05.2-06 — highlightPlacesView groups the catalogue by place', () => {
  const A = '0c000000-0000-4000-8000-00000000000a';
  const B = '0c000000-0000-4000-8000-00000000000b';
  const GONE = '0c000000-0000-4000-8000-0000000000ff';
  const communities = [
    { id: A, name: 'Avisos da diretoria' },
    { id: B, name: 'Coral Rede Social' },
  ];
  const home = highlight({ id: '0000000a-1111-4111-8111-000000000001', title: 'Protocolos' });
  const empty = highlight({
    id: '0000000a-1111-4111-8111-000000000002',
    title: 'Aulas',
    coverAssetId: null,
    coverVariantWidths: [],
    itemCount: 0,
    position: 1,
  });
  const inB = highlight({
    id: '0000000a-1111-4111-8111-000000000003',
    communityId: B,
    title: 'Ensaios',
  });
  const inA = highlight({
    id: '0000000a-1111-4111-8111-000000000004',
    communityId: A,
    title: 'Assembleias',
    coverAssetId: null,
    coverVariantWidths: [],
  });
  const orphan = highlight({
    id: '0000000a-1111-4111-8111-000000000005',
    communityId: GONE,
    title: 'Antigo',
  });

  it('23. Início first under its label, then communities in the LIST order, each row with its cover or null', () => {
    const places = highlightPlacesView([home, empty, inB, inA], communities, {
      homeLabel: 'Início',
    });

    expect(places.map((p) => [p.key, p.label, p.communityId])).toEqual([
      ['home', 'Início', null],
      [A, 'Avisos da diretoria', A],
      [B, 'Coral Rede Social', B],
    ]);
    // Empty highlights ARE listed (a curator is filling them, UI E09 partial), in catalogue order.
    expect(places[0]?.rows).toEqual([
      {
        id: home.id,
        title: 'Protocolos',
        cover: { assetId: '0000000b-1111-4111-8111-111111111111', variantWidths: [640, 1080] },
      },
      { id: empty.id, title: 'Aulas', cover: null },
    ]);
    expect(places[1]?.rows).toEqual([{ id: inA.id, title: 'Assembleias', cover: null }]);
  });

  it('24. a highlight of a community NOT in the active list is dropped; a place with no highlight has no group', () => {
    expect(
      highlightPlacesView([inB, orphan], communities, { homeLabel: 'Início' }).map((p) => p.key),
    ).toEqual([B]);
    // Zero highlights anywhere: no group at all — the sheet's empty state (UI E09 empty).
    expect(highlightPlacesView([], communities, { homeLabel: 'Início' })).toEqual([]);
  });

  it('25. includeEmptyPlaces lists Início and EVERY active community, highlights or not (plan 08)', () => {
    const places = highlightPlacesView([inB, orphan], communities, {
      homeLabel: 'Início',
      includeEmptyPlaces: true,
    });
    expect(places.map((p) => [p.key, p.rows.length])).toEqual([
      ['home', 0],
      [A, 0],
      [B, 1],
    ]);
  });
});

describe('05.2-07 — storyHistoryView carries the highlight indicator (UI-D-77, UI E12)', () => {
  const tm = createTranslator({
    locale: 'pt-BR',
    messages: loadMessages(),
    namespace: 'media',
  } as never) as unknown as (key: string, values?: Record<string, string | number>) => string;

  function story(overrides: Partial<StorySummary> = {}): StorySummary {
    return {
      id: '0000000c-1111-4111-8111-111111111111',
      authorUserId: '0000000d-1111-4111-8111-111111111111',
      mediaAssetId: '0000000e-1111-4111-8111-111111111111',
      mediaKind: 'image',
      mediaVariantWidths: [640, 1080],
      mediaStatus: 'ready',
      mediaFailureReason: null,
      caption: 'Ensaio geral',
      publishedAt: '2026-09-20T12:00:00.000Z',
      expiresAt: '2026-09-21T12:00:00.000Z',
      isActive: false,
      durationSeconds: null,
      likeCount: 0,
      commentCount: 0,
      viewerLiked: false,
      highlightCount: 0,
      viewerSeen: false,
      authorAvatarUrl: null,
      ...overrides,
    };
  }

  it('V1. highlightCount 2 → highlighted { count: 2, label: "Em 2 destaques" }; 1 → the singular', () => {
    expect(storyHistoryView(story({ highlightCount: 2 }), t, tm).highlighted).toEqual({
      count: 2,
      label: 'Em 2 destaques',
    });
    expect(storyHistoryView(story({ highlightCount: 1 }), t, tm).highlighted).toEqual({
      count: 1,
      label: 'Em 1 destaque',
    });
  });

  it('V1. highlightCount 0 → the key is ABSENT (never "Em 0 destaques"), and no pin indicator exists', () => {
    const view = storyHistoryView(story({ highlightCount: 0 }), t, tm);
    expect('highlighted' in view).toBe(false);
    expect('pinned' in view).toBe(false);
  });
});

/* ── 05.2-09: the manage screen's views (UI-D-72, UI-D-74) ──────────────────────────────────── */

describe('05.2-09 — highlightManageRowView and highlightEditStoryView', () => {
  const tm = createTranslator({
    locale: 'pt-BR',
    messages: loadMessages(),
    namespace: 'media',
  } as never) as unknown as (key: string, values?: Record<string, string | number>) => string;

  function story(overrides: Partial<StorySummary> = {}): StorySummary {
    return {
      id: '0000000c-1111-4111-8111-111111111111',
      authorUserId: '0000000d-1111-4111-8111-111111111111',
      mediaAssetId: '0000000e-1111-4111-8111-111111111111',
      mediaKind: 'image',
      mediaVariantWidths: [640, 1080],
      mediaStatus: 'ready',
      mediaFailureReason: null,
      caption: 'Ensaio geral',
      publishedAt: '2026-09-20T12:00:00.000Z',
      expiresAt: '2026-09-21T12:00:00.000Z',
      isActive: false,
      durationSeconds: null,
      likeCount: 0,
      commentCount: 0,
      viewerLiked: false,
      highlightCount: 1,
      viewerSeen: false,
      authorAvatarUrl: null,
      ...overrides,
    };
  }

  it('26. the row meta is the ICU plural of itemCount, or "Vazio · só você vê" for an empty highlight', () => {
    expect(highlightManageRowView(highlight({ itemCount: 3 }), t)).toEqual({
      id: '0000000a-1111-4111-8111-111111111111',
      communityId: null,
      title: 'Bastidores',
      meta: '3 stories',
      cover: { assetId: '0000000b-1111-4111-8111-111111111111', variantWidths: [640, 1080] },
      coverChosen: false,
      itemCount: 3,
      editLabel: 'Editar destaque Bastidores',
    });
    expect(highlightManageRowView(highlight({ itemCount: 1 }), t).meta).toBe('1 story');
    const empty = highlightManageRowView(highlight({ itemCount: 0, coverAssetId: null }), t);
    expect(empty.meta).toBe('Vazio · só você vê');
    // No resolvable cover → null, and the card draws the 48px monogram at identical geometry.
    expect(empty.cover).toBeNull();
  });

  it('27. an edit story row: the history date, the media pill when not ready, isCover by the resolved asset', () => {
    const date = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(
      new Date('2026-09-20T12:00:00.000Z'),
    );
    const cover = highlightEditStoryView(story(), '0000000e-1111-4111-8111-111111111111', t, tm);
    expect(cover).toEqual({
      id: '0000000c-1111-4111-8111-111111111111',
      thumb: { assetId: '0000000e-1111-4111-8111-111111111111', variantWidths: [640, 1080] },
      mediaKind: 'image',
      dateLabel: date,
      isCover: true,
      removeLabel: `Remover do destaque o story de ${date}`,
    });
    // The automatic rule and a chosen frame both resolve to the story's own asset; another asset
    // (an uploaded cover, or another story) is not this row.
    expect(highlightEditStoryView(story(), null, t, tm).isCover).toBe(false);
    expect(
      highlightEditStoryView(story(), '0000000f-1111-4111-8111-111111111111', t, tm).isCover,
    ).toBe(false);

    const processing = highlightEditStoryView(
      story({ mediaKind: 'video', mediaStatus: 'processing' }),
      null,
      t,
      tm,
    );
    expect(processing.status).toEqual({ tone: 'warning', label: 'Processando' });
    const rejected = highlightEditStoryView(story({ mediaStatus: 'rejected' }), null, t, tm);
    expect(rejected.status).toEqual({ tone: 'danger', label: 'Recusado' });
  });

  it('28. the history view carries the bare date for the picker row (UI-D-76)', () => {
    const date = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(
      new Date('2026-09-20T12:00:00.000Z'),
    );
    expect(storyHistoryView(story(), t, tm).date).toBe(date);
  });
});

/* ── 05.2-10: the seen ring and the resume index (HIGHLIGHT-06, D-105, UI-D-61) ─────────────── */

describe('the tenant circle’s seen state (05.2-10)', () => {
  const seenItems = (flags: boolean[]) =>
    flags.map((seen, index) => ({ id: `story-${index}`, seen }));

  it('29. storyViewerItem carries the caller’s own viewerSeen as `seen`', () => {
    const summary: StorySummary = {
      id: '0000000c-1111-4111-8111-111111111111',
      authorUserId: '0000000d-1111-4111-8111-111111111111',
      mediaAssetId: '0000000e-1111-4111-8111-111111111111',
      mediaKind: 'image',
      mediaVariantWidths: [640, 1080],
      mediaStatus: 'ready',
      mediaFailureReason: null,
      caption: '',
      publishedAt: '2026-09-20T12:00:00.000Z',
      expiresAt: '2026-09-21T12:00:00.000Z',
      isActive: true,
      durationSeconds: null,
      likeCount: 0,
      commentCount: 0,
      viewerLiked: false,
      highlightCount: 0,
      viewerSeen: true,
      authorAvatarUrl: null,
    };
    const now = Date.parse('2026-09-20T13:00:00.000Z');
    expect(storyViewerItem(summary, now).seen).toBe(true);
    expect(storyViewerItem({ ...summary, viewerSeen: false }, now).seen).toBe(false);
  });

  it('30. [seen, unseen, seen] oldest first → something is new, and it resumes at the FIRST unseen (index 1)', () => {
    expect(tenantSeenState(seenItems([true, false, true]))).toEqual({
      anyUnseen: true,
      resumeIndex: 1,
    });
    expect(tenantSeenState(seenItems([false, false]))).toEqual({ anyUnseen: true, resumeIndex: 0 });
  });

  it('31. all seen → nothing new and it resumes at 0; the SESSION set completes the server flags', () => {
    expect(tenantSeenState(seenItems([true, true]))).toEqual({ anyUnseen: false, resumeIndex: 0 });
    expect(tenantSeenState(seenItems([true, false, false]), new Set(['story-1']))).toEqual({
      anyUnseen: true,
      resumeIndex: 2,
    });
    expect(tenantSeenState(seenItems([true, false]), new Set(['story-1']))).toEqual({
      anyUnseen: false,
      resumeIndex: 0,
    });
    // An empty sequence has nothing new (no tenant circle is drawn for it anyway).
    expect(tenantSeenState([])).toEqual({ anyUnseen: false, resumeIndex: 0 });
  });

  it('32. tenantCircleView: brand + "Há stories novos." + the resume index while unseen; neutral + the plain name once seen', () => {
    const tenant = { displayName: 'Demo', logoUrl: null };
    expect(tenantCircleView(tenant, t, { anyUnseen: true, resumeIndex: 2 })).toMatchObject({
      ring: 'brand',
      actionLabel: 'Abrir stories de Demo. Há stories novos.',
      group: 0,
      index: 2,
    });
    expect(tenantCircleView(tenant, t, { anyUnseen: false, resumeIndex: 0 })).toMatchObject({
      ring: 'neutral',
      actionLabel: 'Abrir stories de Demo',
      group: 0,
      index: 0,
    });
    // The ring GEOMETRY is the module's; only the ring kind changes (UI-D-61).
    const row = inicioRow(
      {
        canPublish: false,
        tenant,
        sequenceLength: 2,
        highlights: [highlight()],
        tenantSeen: { anyUnseen: false, resumeIndex: 0 },
      },
      t,
    );
    expect(row[0]).toMatchObject({ key: 'tenant', ring: 'neutral' });
    // Highlight circles never wear a seen ring.
    expect(row[1]).toMatchObject({ ring: 'neutral' });
  });
});

/* ── #2b (2026-10-03): the tenant circle wears the newest author's face ─────────────────────────── */

/**
 * The client's item #2b (the author's photo in the tenant circle): the tenant circle shows the photo of
 * whoever published the tenant's NEWEST live story — the owner, in V1 — and keeps the tenant's logo
 * (or monogram) as that photo's fallback and as the disc when there is no photo. The claims a later
 * edit could quietly break:
 *
 *  - WHICH photo: the newest story's author (the last of the oldest-first sequence, the API page's
 *    first), and an older story's author is never promoted when the newest one's has none;
 *  - WHAT the circle keeps: its label and its two accessible names are the tenant's, with or without
 *    the photo — only the disc changes, and the fallback is exactly the pre-#2b disc;
 *  - WHERE it applies: the tenant circle only; highlight circles keep their covers.
 */
describe('#2b — the tenant circle wears the face of the newest story’s author', () => {
  const FACE = '/v1/media/0000000f-1111-4111-8111-111111111111/w128';
  const OLDER_FACE = '/v1/media/0000000f-2222-4222-8222-222222222222/w128';

  it('33. the face is the NEWEST story’s author (the sequence’s last); an older author is never promoted; empty is null', () => {
    // Oldest first (D-106): the last element is the newest live story.
    expect(tenantCircleFace([{ authorAvatarUrl: OLDER_FACE }, { authorAvatarUrl: FACE }])).toBe(
      FACE,
    );
    // The newest author has no photo → no face at all, even though an older story's author has one.
    expect(
      tenantCircleFace([{ authorAvatarUrl: OLDER_FACE }, { authorAvatarUrl: null }]),
    ).toBeNull();
    expect(tenantCircleFace([])).toBeNull();

    // End to end from the API's newest-FIRST page, through the slot's own reversal.
    const page = {
      items: [
        { id: 'newest', authorAvatarUrl: FACE },
        { id: 'oldest', authorAvatarUrl: OLDER_FACE },
      ],
    };
    expect(tenantCircleFace(tenantSequence(page))).toBe(FACE);
  });

  it('34. with a face: a photo disc whose fallback is the logo; label and both names stay the tenant’s', () => {
    const tenant = { displayName: 'Demo', logoUrl: '/logo.png' };
    const unseen = tenantCircleView(tenant, t, { anyUnseen: true, resumeIndex: 1 }, FACE);
    expect(unseen).toMatchObject({
      kind: 'open',
      key: 'tenant',
      label: 'Demo',
      actionLabel: 'Abrir stories de Demo. Há stories novos.',
      ring: 'brand',
      group: 0,
      index: 1,
    });
    expect(unseen.disc).toEqual({
      kind: 'photo',
      src: FACE,
      fallback: { kind: 'logo', src: '/logo.png' },
    });
    expect(tenantCircleView(tenant, t, { anyUnseen: false, resumeIndex: 0 }, FACE)).toMatchObject({
      label: 'Demo',
      actionLabel: 'Abrir stories de Demo',
      ring: 'neutral',
    });
  });

  it('35. a logo-less tenant’s photo falls back to the monogram; no face is EXACTLY the pre-#2b disc', () => {
    const tenant = { displayName: 'édson escola', logoUrl: null };
    const seen = { anyUnseen: true, resumeIndex: 0 };
    expect(tenantCircleView(tenant, t, seen, FACE).disc).toEqual({
      kind: 'photo',
      src: FACE,
      fallback: { kind: 'monogram', text: 'É' },
    });
    // Without a face — an explicit null or no argument at all — the disc is the tenant identity.
    expect(tenantCircleView(tenant, t, seen, null).disc).toEqual({ kind: 'monogram', text: 'É' });
    expect(tenantCircleView(tenant, t, seen).disc).toEqual({ kind: 'monogram', text: 'É' });
    expect(
      tenantCircleView({ displayName: 'Demo', logoUrl: '/logo.png' }, t, seen, null).disc,
    ).toEqual({ kind: 'logo', src: '/logo.png' });
  });

  it('36. inicioRow puts the face on the tenant circle ONLY — highlights keep their covers', () => {
    const tenant = { displayName: 'Demo', logoUrl: '/logo.png' };
    const row = inicioRow(
      {
        canPublish: true,
        tenant,
        sequenceLength: 2,
        tenantFace: FACE,
        highlights: [highlight()],
      },
      t,
    );
    expect(row.map((c) => c.disc.kind)).toEqual(['own', 'photo', 'asset']);
    expect(row[1]).toMatchObject({
      key: 'tenant',
      label: 'Demo',
      disc: { kind: 'photo', src: FACE, fallback: { kind: 'logo', src: '/logo.png' } },
    });
    // No face (absent, or nothing live to take it from): the logo, as before #2b.
    const plain = inicioRow({ canPublish: false, tenant, sequenceLength: 1, highlights: [] }, t);
    expect(plain[0]?.disc).toEqual({ kind: 'logo', src: '/logo.png' });
    // A face with nothing live draws no tenant circle at all (UI-D-59 (2) is unchanged).
    expect(
      inicioRow(
        { canPublish: false, tenant, sequenceLength: 0, tenantFace: FACE, highlights: [] },
        t,
      ),
    ).toEqual([]);
  });

  it('37. storyViewerItem carries each story’s OWN author photo, or null', () => {
    const summary: StorySummary = {
      id: '0000000c-1111-4111-8111-111111111111',
      authorUserId: '0000000d-1111-4111-8111-111111111111',
      authorAvatarUrl: FACE,
      mediaAssetId: '0000000e-1111-4111-8111-111111111111',
      mediaKind: 'image',
      mediaVariantWidths: [640, 1080],
      mediaStatus: 'ready',
      mediaFailureReason: null,
      caption: '',
      publishedAt: '2026-09-20T12:00:00.000Z',
      expiresAt: '2026-09-21T12:00:00.000Z',
      isActive: true,
      durationSeconds: null,
      likeCount: 0,
      commentCount: 0,
      viewerLiked: false,
      highlightCount: 0,
      viewerSeen: false,
    };
    const now = Date.parse('2026-09-20T13:00:00.000Z');
    expect(storyViewerItem(summary, now).authorAvatarUrl).toBe(FACE);
    expect(storyViewerItem({ ...summary, authorAvatarUrl: null }, now).authorAvatarUrl).toBeNull();
  });
});
