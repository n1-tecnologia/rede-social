import type { HighlightSummary } from '@tria/module-stories/contracts';
import { STORY_MAX_PAGE_SIZE } from '@tria/module-stories/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import {
  highlightCircleView,
  inicioRow,
  monogramOf,
  tenantCircleView,
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

  it('12. is INERT in this plan — a static circle, never a link and never an opener', () => {
    expect(highlightCircleView(highlight(), t).kind).toBe('static');
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
