// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HighlightSummary } from '@rede-social/module-stories/contracts';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  highlightCircleView,
  highlightGroupView,
  highlightPlacesView,
  highlightRowCircles,
  inicioRow,
  type StoryViewerLabelsView,
} from '@/lib/story-view';
import { StoriesBand } from './StoriesBand';
import { StoriesSurface } from './StoriesSurface';

/**
 * 11.1-13 Task 2 (UI-D-887, T-11.1-49): the open flag is the CURATOR's. A member-facing highlight
 * circle, the strip, the band, the surface, the viewer's group and the buyer's destination catalogue
 * must be byte-identical for an open and a closed highlight: no field, class, `data-` attribute or aria
 * text derived from openness. The builders below are the ones the member pages call; the render is the
 * real `StoriesBand` > `StoriesSurface` > module `StoriesStrip` > `StoryCircle` chain.
 */

vi.mock('./StoryViewerHost', () => ({ StoryViewerHost: () => null }));
vi.mock('@/app/(app)/stories/highlight-actions', () => ({
  loadHighlightItemsAction: vi.fn(async () => ({ ok: false })),
}));
vi.mock('@/app/(app)/stories/story-actions', () => ({
  markStoriesSeenAction: vi.fn(async () => true),
  loadAuthorStoriesAction: vi.fn(async () => ({ ok: false })),
}));
vi.mock('@/lib/seen-batch', () => ({ sendSeenBeacon: vi.fn(async () => true) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);

const COMMUNITY = '44444444-4444-4444-8444-444444444444';

function summary(n: number, openToBuyers: boolean | undefined, itemCount = 2): HighlightSummary {
  return {
    id: `0000000a-1111-4111-8111-00000000000${n}`,
    communityId: COMMUNITY,
    title: `Destaque ${n}`,
    position: n,
    coverAssetId: n % 2 === 0 ? null : `0000000b-1111-4111-8111-00000000000${n}`,
    coverVariantWidths: n % 2 === 0 ? [] : [640, 1080],
    coverStoryId: null,
    coverChosen: false,
    itemCount,
    ...(openToBuyers === undefined ? {} : { openToBuyers }),
  };
}

/** The same four highlights, open ones first, closed ones second, and with the flag absent. */
const WITH_FLAG = [summary(1, true), summary(2, false), summary(3, true), summary(4, false)];
const WITHOUT_FLAG = [
  summary(1, undefined),
  summary(2, undefined),
  summary(3, undefined),
  summary(4, undefined),
];
/** An EMPTY highlight is a curator-only dashed link; open or closed it must read the same too. */
const EMPTY_OPEN = [summary(1, true, 0), summary(2, true)];
const EMPTY_CLOSED = [summary(1, false, 0), summary(2, false)];

const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}:${JSON.stringify(values)}` : key;

/** React's generated ids differ between two renders of the same tree; the markup must not otherwise. */
const normalise = (html: string) => html.replace(/_r_[0-9a-z]+_|:r[0-9a-z]+:/g, 'ID');

function band(highlights: readonly HighlightSummary[], curator = false) {
  const circles = highlightRowCircles(
    highlights,
    0,
    t,
    curator
      ? { manageHref: `/comunidades/${COMMUNITY}/destaques`, manageActionLabel: 'g' }
      : undefined,
  );
  const { container } = render(
    <StoriesBand>
      <StoriesSurface
        circles={circles}
        regionLabel="Stories"
        viewer={{
          groups: highlights.filter((h) => h.itemCount > 0).map(highlightGroupView),
          labels: {} as StoryViewerLabelsView,
          onLike: vi.fn(),
          onUnlike: vi.fn(),
        }}
      />
    </StoriesBand>,
  );
  const html = normalise(container.innerHTML);
  cleanup();
  return html;
}

describe('the open flag never reaches a member-facing highlight surface (UI-D-887, T-11.1-49)', () => {
  it('N1. the band, surface, strip and circles are byte-identical for open and closed highlights', () => {
    const open = band(WITH_FLAG);
    expect(open.length).toBeGreaterThan(100);
    expect(open).toBe(band(WITHOUT_FLAG));
    expect(open).not.toMatch(/openToBuyers|aberto a|compradores|buyer/i);
  });

  it('N2. even the curator row (empty dashed links, the manage circle) does not tell open from closed', () => {
    expect(band(EMPTY_OPEN, true)).toBe(band(EMPTY_CLOSED, true));
  });

  it('N3. the circle, the viewer group, the row and the destination catalogue carry no flag at all', () => {
    for (const [open, closed] of [
      [summary(1, true), summary(1, false)],
      [summary(2, true), summary(2, undefined)],
    ] as const) {
      expect(highlightCircleView(open, t, 0)).toEqual(highlightCircleView(closed, t, 0));
      expect(highlightGroupView(open)).toEqual(highlightGroupView(closed));
      expect(JSON.stringify(highlightCircleView(open, t, 0))).not.toMatch(
        /openToBuyers|buyer|compradores/i,
      );
      expect(JSON.stringify(highlightGroupView(open))).not.toMatch(
        /openToBuyers|buyer|compradores/i,
      );
    }
    const inicio = (highlights: readonly HighlightSummary[]) =>
      inicioRow(
        {
          canPublish: false,
          tenant: { displayName: 'Rede', logoUrl: null },
          sequenceLength: 0,
          highlights,
        },
        t,
      );
    expect(inicio(WITH_FLAG)).toEqual(inicio(WITHOUT_FLAG));

    const places = (highlights: readonly HighlightSummary[]) =>
      highlightPlacesView(highlights, [{ id: COMMUNITY, name: 'Clube' }], { homeLabel: 'Início' });
    expect(places(WITH_FLAG)).toEqual(places(WITHOUT_FLAG));
    expect(JSON.stringify(places(WITH_FLAG))).not.toMatch(/openToBuyers|buyer|compradores/i);
  });

  it('N4. no member-facing file of the stories surface names the flag', () => {
    const files = [
      'components/stories/StoriesBand.tsx',
      'components/stories/StoriesSurface.tsx',
      'components/stories/StoryViewerHost.tsx',
      '../../packages/modules/stories/ui/StoriesStrip.tsx',
      '../../packages/modules/stories/ui/StoryCircle.tsx',
      '../../packages/modules/stories/ui/StoryViewer.tsx',
      '../../packages/modules/stories/ui/HighlightSheet.tsx',
    ];
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      expect(source, file).not.toMatch(/openToBuyers|open_to_buyers|highlightOpen/);
    }
  });
});
