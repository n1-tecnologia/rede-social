import type { HighlightSummary } from '@tria/module-stories/contracts';
import { STORY_MAX_PAGE_SIZE } from '@tria/module-stories/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import {
  highlightCircleView,
  highlightGroupView,
  inicioGroups,
  inicioRow,
  monogramOf,
  type StoryViewerItemView,
  storyViewerLabels,
  tenantCircleView,
  tenantGroupView,
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
    const circle = tenantCircleView({ displayName: 'Demo', logoUrl: '/logo.png' }, t);
    expect(circle).toMatchObject({
      kind: 'open',
      key: 'tenant',
      label: 'Demo',
      actionLabel: 'Abrir stories de Demo',
      ring: 'brand',
      disc: { kind: 'logo', src: '/logo.png' },
      group: 0,
      index: 0,
    });
  });

  it('9. without a logo: the monogram of the display name', () => {
    const circle = tenantCircleView({ displayName: 'édson escola', logoUrl: null }, t);
    expect(circle.disc).toEqual({ kind: 'monogram', text: 'É' });
    expect(circle.label).toBe('édson escola');
  });
});

describe('highlightCircleView — one highlight circle (UI-D-61, UI-D-62)', () => {
  it('10. with a resolved cover: an asset disc, the title as label, "Abrir destaque {title}", neutral', () => {
    const circle = highlightCircleView(highlight(), t);
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
    const circle = highlightCircleView(highlight({ coverAssetId: null, title: 'aulas' }), t);
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
  const own = { avatarUrl: null };

  it('13. an admin with live stories and highlights: + , tenant, highlights in API order', () => {
    const row = inicioRow(
      {
        canPublish: true,
        own,
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
    expect(row[0]).toMatchObject({ kind: 'link', href: '/stories/publicar', ring: 'neutral' });
    expect(row[1]).toMatchObject({ kind: 'open', ring: 'brand', group: 0, index: 0 });
    // Each highlight opens the group right after the tenant's, in row order.
    expect(row[2]).toMatchObject({ kind: 'open', group: 1, index: 0 });
    expect(row[3]).toMatchObject({ kind: 'open', group: 2, index: 0 });
  });

  it('14. a member never gets the + circle', () => {
    const row = inicioRow({ canPublish: false, own, tenant, sequenceLength: 1, highlights: [] }, t);
    expect(row.map((c) => c.label)).toEqual(['Demo']);
  });

  it('15. nothing live → no tenant circle; the highlights still render (UI-D-59, partial E01)', () => {
    const row = inicioRow(
      { canPublish: false, own, tenant, sequenceLength: 0, highlights: [highlight()] },
      t,
    );
    expect(row.map((c) => c.label)).toEqual(['Bastidores']);
    // With no tenant group in front of it, the first highlight IS group 0.
    expect(row[0]).toMatchObject({ kind: 'open', group: 0, index: 0 });
  });

  it('16. a member with nothing gets NO circle at all (UI-D-26)', () => {
    expect(
      inicioRow({ canPublish: false, own, tenant, sequenceLength: 0, highlights: [] }, t),
    ).toEqual([]);
  });

  it('17. an admin with nothing still gets the + circle alone (D-108)', () => {
    const row = inicioRow({ canPublish: true, own, tenant, sequenceLength: 0, highlights: [] }, t);
    expect(row.map((c) => c.kind)).toEqual(['link']);
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
      highlights: [highlight(), second],
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
        own: { avatarUrl: null },
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
      highlights: [highlight()],
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
