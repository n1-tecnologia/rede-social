// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markStoriesSeenAction } from '@/app/(app)/stories/story-actions';
import { sendSeenBeacon } from '@/lib/seen-batch';
import type {
  RowCircleView,
  StoryGroupView,
  StoryViewerItemView,
  StoryViewerLabelsView,
} from '@/lib/story-view';
import { StoriesSurface } from './StoriesSurface';
import type { StoryInteractions } from './story-interactions';

/**
 * 05.2-10 — the tenant circle's seen ring and resume index, and the buffered seen writes behind them
 * (HIGHLIGHT-06, D-105, UI-D-61, R-P5).
 *
 * `StoriesSurface` is where the session state lives: the viewer reports each segment it SHOWED
 * (`onSegmentShown`, plan 05), the surface keeps a session seen set (so the ring greys on close with
 * no server round trip) and a buffer it flushes through `markStoriesSeenAction` — on close, on a
 * group change, at 10 ids and when the page hides. The claims:
 *
 *  - S1/S2: the ring, the accessible name and the resume index come from the server's `seen` flags;
 *  - S3: the session set re-derives the ring on close, with no new server data;
 *  - S4: every flush trigger, one call each, and an id already sent is never sent again; the
 *    page-hide flush leaves through `sendSeenBeacon` (review WR-07), every other one through the
 *    action;
 *  - S5: a failed flush is logged and swallowed — no toast, no navigation, the viewer stays;
 *  - S6: a refused beacon is logged by shape and forgets its ids, so they are sent again later;
 *  - S8: CR-01, every host the surface mounts gets the page's ONE interactions store;
 *  - S9/S10 (2026-10-20, the client's FRONT.pdf): a story a curator deleted from the viewer leaves
 *    every group at once and the route is refreshed ONCE after the viewer closes; the share and the
 *    desktop arrows reach the host and the strip.
 *
 * The viewer host is STUBBED: it records the props the surface hands it and exposes the two
 * callbacks the surface owns (`onSegmentShown`, `onClose`). The strip and its circles are REAL, so
 * the ring class and the accessible name are asserted on the rendered control.
 */

type HostProps = {
  groups: readonly (StoryGroupView & { failed?: boolean })[];
  initialGroup: number;
  initialIndex: number;
  onClose?: () => void;
  onSegmentShown?: (storyId: string, groupKey: string) => void;
  interactions?: StoryInteractions;
  share?: { origin: string; title: string };
  onStoryDeleted?: (storyId: string) => void;
  onNeedGroup?: (group: number) => void;
};

const host: { props: HostProps | null } = { props: null };

vi.mock('./StoryViewerHost', () => ({
  StoryViewerHost: (props: HostProps) => {
    host.props = props;
    return (
      <div
        data-testid="viewer"
        data-group={String(props.initialGroup)}
        data-index={String(props.initialIndex)}
      />
    );
  },
}));

vi.mock('@/app/(app)/stories/highlight-actions', () => ({
  loadHighlightItemsAction: vi.fn(async () => ({ ok: false })),
}));

vi.mock('@/app/(app)/stories/story-actions', () => ({
  markStoriesSeenAction: vi.fn(async () => true),
}));

vi.mock('@/lib/seen-batch', () => ({
  sendSeenBeacon: vi.fn(async () => true),
}));

/** 2026-10-20: the surface refreshes its route after a deletion. ONE router object, as Next's. */
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const SEEN_LABEL = 'Abrir stories de Demo';
const UNSEEN_LABEL = 'Abrir stories de Demo. Há stories novos.';

function id(n: number): string {
  return `0d000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function item(n: number, seen: boolean): StoryViewerItemView {
  return {
    id: id(n),
    mediaKind: 'image',
    mediaAssetId: '0000000e-1111-4111-8111-111111111111',
    mediaVariantWidths: [640],
    caption: '',
    timeLabel: 'há 1 h',
    likeCount: 0,
    commentCount: 0,
    viewerLiked: false,
    seen,
    authorAvatarUrl: null,
  };
}

/** The tenant group (oldest first) and one LOADED highlight group whose story is id 100. */
function groups(flags: boolean[]): StoryGroupView[] {
  return [
    {
      key: 'tenant',
      kind: 'tenant',
      highlightId: null,
      name: 'Demo',
      avatar: { kind: 'avatar', src: null },
      items: flags.map((seen, n) => item(n + 1, seen)),
    },
    {
      key: 'h1',
      kind: 'highlight',
      highlightId: '0000000a-1111-4111-8111-111111111111',
      name: 'Bastidores',
      avatar: { kind: 'monogram', text: 'B' },
      items: [item(100, false)],
    },
  ];
}

/** The row as the SERVER composed it — deliberately stale here, so the surface must derive. */
const circles: RowCircleView[] = [
  {
    kind: 'open',
    key: 'tenant',
    label: 'Demo',
    actionLabel: SEEN_LABEL,
    ring: 'brand',
    disc: { kind: 'monogram', text: 'D' },
    group: 0,
    index: 0,
  },
  {
    kind: 'open',
    key: '0000000a-1111-4111-8111-111111111111',
    label: 'Bastidores',
    actionLabel: 'Abrir destaque Bastidores',
    ring: 'neutral',
    disc: { kind: 'monogram', text: 'B' },
    group: 1,
    index: 0,
  },
];

function renderSurface(flags: boolean[], rowCircles: RowCircleView[] = circles) {
  return render(
    <StoriesSurface
      circles={rowCircles}
      regionLabel="Stories"
      viewer={{
        groups: groups(flags),
        labels: {} as StoryViewerLabelsView,
        onLike: vi.fn(),
        onUnlike: vi.fn(),
        seenRing: { seenLabel: SEEN_LABEL, unseenLabel: UNSEEN_LABEL },
      }}
    />,
  );
}

const tenantButton = () =>
  screen.getByRole('button', { name: (name) => name.startsWith(SEEN_LABEL) });
const ringOf = (button: HTMLElement) => within(button).getByTestId('story-circle-ring');

function openTenant() {
  fireEvent.click(tenantButton());
}

function shown(n: number, groupKey = 'tenant') {
  act(() => host.props?.onSegmentShown?.(id(n), groupKey));
}

function close() {
  act(() => host.props?.onClose?.());
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

const calls = () => vi.mocked(markStoriesSeenAction).mock.calls.map(([ids]) => ids);
const beacons = () => vi.mocked(sendSeenBeacon).mock.calls.map(([ids]) => ids);

beforeEach(() => {
  host.props = null;
  router.refresh.mockReset();
  vi.mocked(markStoriesSeenAction).mockReset();
  vi.mocked(markStoriesSeenAction).mockResolvedValue(true);
  vi.mocked(sendSeenBeacon).mockReset();
  vi.mocked(sendSeenBeacon).mockResolvedValue(true);
  // A shallow history entry is popped by `back()`; happy-dom does not fire `popstate` for it, so
  // the stub does what the browser does.
  vi.spyOn(window.history, 'back').mockImplementation(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  window.history.replaceState(null, '', '/inicio');
});

afterEach(() => {
  cleanup();
  setVisibility('visible');
  vi.restoreAllMocks();
});

describe('StoriesSurface — the seen ring and the resume (05.2-10)', () => {
  it('S1. [seen, unseen, seen] → the brand ring, "… Há stories novos." and it opens at index 1', () => {
    renderSurface([true, false, true]);

    const button = tenantButton();
    expect(button.getAttribute('aria-label')).toBe(UNSEEN_LABEL);
    expect(ringOf(button).className).toContain('border-brand');

    openTenant();
    expect(screen.getByTestId('viewer').dataset.group).toBe('0');
    expect(screen.getByTestId('viewer').dataset.index).toBe('1');
  });

  it('S2. all seen → the neutral ring, the plain name, and it opens at index 0', () => {
    renderSurface([true, true, true]);

    const button = tenantButton();
    expect(button.getAttribute('aria-label')).toBe(SEEN_LABEL);
    expect(ringOf(button).className).toContain('border-border');
    expect(ringOf(button).className).not.toContain('border-brand');

    openTenant();
    expect(screen.getByTestId('viewer').dataset.index).toBe('0');
    // Highlight circles never wear a seen ring (UI-D-61).
    const highlightButton = screen.getByRole('button', { name: 'Abrir destaque Bastidores' });
    expect(ringOf(highlightButton).className).toContain('border-border');
  });

  it('S3. the viewer shows the only unseen story and closes → the ring is neutral with no new server data', async () => {
    renderSurface([true, false, true]);
    openTenant();
    shown(2);
    close();
    await settle();

    expect(screen.queryByTestId('viewer')).toBeNull();
    const button = tenantButton();
    expect(button.getAttribute('aria-label')).toBe(SEEN_LABEL);
    expect(ringOf(button).className).toContain('border-border');

    // …and opening it again resumes at 0: everything is seen now.
    openTenant();
    expect(screen.getByTestId('viewer').dataset.index).toBe('0');
  });

  it('S4. the buffer flushes on close, on a group change, at 10 ids and when the page hides — never twice', async () => {
    // Close: only the story the server did not already know as seen is sent.
    const first = renderSurface([true, false, true]);
    openTenant();
    shown(1);
    shown(2);
    expect(calls()).toEqual([]);
    close();
    await settle();
    expect(calls()).toEqual([[id(2)]]);

    // An id already flushed in the session is never sent again.
    openTenant();
    shown(2);
    close();
    await settle();
    expect(calls()).toEqual([[id(2)]]);
    first.unmount();

    // A group change flushes what was collected BEFORE the new group's story joins the buffer.
    vi.mocked(markStoriesSeenAction).mockClear();
    const second = renderSurface([false, false]);
    openTenant();
    shown(1);
    shown(2);
    shown(100, 'h1');
    expect(calls()).toEqual([[id(1), id(2)]]);
    close();
    await settle();
    expect(calls()).toEqual([[id(1), id(2)], [id(100)]]);
    second.unmount();

    // Ten ids: the tenth shown story triggers ONE call with all ten, while the viewer stays open.
    vi.mocked(markStoriesSeenAction).mockClear();
    const third = renderSurface(Array.from({ length: 12 }, () => false));
    openTenant();
    for (let n = 1; n <= 10; n++) shown(n);
    expect(calls()).toEqual([Array.from({ length: 10 }, (_, n) => id(n + 1))]);
    expect(screen.getByTestId('viewer')).toBeTruthy();
    third.unmount();

    // visibilitychange → hidden flushes what is pending — through the BEACON, not the action,
    // because a server action is a plain fetch the browser may abort on unload (WR-07).
    vi.mocked(markStoriesSeenAction).mockClear();
    renderSurface([false, false]);
    openTenant();
    shown(1);
    act(() => setVisibility('hidden'));
    expect(beacons()).toEqual([[id(1)]]);
    expect(calls()).toEqual([]);
  });

  it('S5. a flush that rejects or answers false is logged and swallowed — no toast, no navigation', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(markStoriesSeenAction).mockRejectedValueOnce(new Error('fetch failed'));
    vi.mocked(markStoriesSeenAction).mockResolvedValueOnce(false);

    renderSurface(Array.from({ length: 20 }, () => false));
    openTenant();
    const url = window.location.href;
    for (let n = 1; n <= 20; n++) shown(n);
    await settle();

    expect(calls()).toHaveLength(2);
    // The shape of the failure only — never an id.
    expect(log).toHaveBeenCalledWith('stories.seen_flush_failed', expect.anything());
    expect(JSON.stringify(log.mock.calls)).not.toContain(id(1));
    // No navigation, no toast: the member is still watching, on the same entry.
    expect(screen.getByTestId('viewer')).toBeTruthy();
    expect(window.location.href).toBe(url);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('S6. a refused page-hide beacon is logged by shape and forgets its ids, so a later close re-sends them', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(sendSeenBeacon).mockResolvedValueOnce(false);

    renderSurface([false, false]);
    openTenant();
    shown(1);
    act(() => setVisibility('hidden'));
    await settle();
    expect(beacons()).toEqual([[id(1)]]);
    expect(log).toHaveBeenCalledWith('stories.seen_flush_failed', {
      count: 1,
      reason: 'refused',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(id(1));

    // The same story shown again after the page comes back is sent again, through the action.
    act(() => setVisibility('visible'));
    shown(1);
    close();
    await settle();
    expect(calls()).toEqual([[id(1)]]);
    expect(beacons()).toHaveLength(1);
  });

  it('S7. #2b: the tenant circle keeps the author’s FACE through every re-derivation of its ring and name', async () => {
    const FACE = '/v1/media/0000000f-1111-4111-8111-111111111111/w128';
    const withFace: RowCircleView[] = [
      {
        ...(circles[0] as RowCircleView),
        disc: { kind: 'photo', src: FACE, fallback: { kind: 'monogram', text: 'D' } },
      },
      circles[1] as RowCircleView,
    ];
    // happy-dom reports every `<img>` as `complete` with a zero `naturalWidth` (a failed fetch); a
    // decoded image is forced so the photo stands, and the accessors are restored afterwards.
    const saved = ['complete', 'naturalWidth'].map(
      (key) => [key, Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, key)] as const,
    );
    Object.defineProperty(HTMLImageElement.prototype, 'complete', {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
      configurable: true,
      get: () => 128,
    });
    try {
      renderSurface([true, false, true], withFace);
      expect(tenantButton().getAttribute('aria-label')).toBe(UNSEEN_LABEL);
      expect(tenantButton().querySelector('img')?.getAttribute('src')).toBe(FACE);

      // The surface re-derives the ring and the NAME on close; the disc it was handed survives.
      openTenant();
      shown(2);
      close();
      await settle();
      const button = tenantButton();
      expect(button.getAttribute('aria-label')).toBe(SEEN_LABEL);
      expect(ringOf(button).className).toContain('border-border');
      expect(button.querySelector('img')?.getAttribute('src')).toBe(FACE);
    } finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(HTMLImageElement.prototype, key, descriptor);
        else delete (HTMLImageElement.prototype as unknown as Record<string, unknown>)[key];
      }
    }
  });

  it('S8. CR-01: two opens with a close between hand the host the SAME interactions store', async () => {
    const first = renderSurface([false, false]);
    openTenant();
    const store = host.props?.interactions;
    expect(store).toBeDefined();

    // The host unmounts on close; the page's store does not.
    close();
    await settle();
    expect(screen.queryByTestId('viewer')).toBeNull();
    openTenant();
    expect(host.props?.interactions).toBe(store);
    first.unmount();

    // It is the PAGE's: another page life starts from a store of its own.
    renderSurface([false, false]);
    openTenant();
    expect(host.props?.interactions).toBeDefined();
    expect(host.props?.interactions).not.toBe(store);
  });
});

describe('StoriesSurface — a story deleted from the viewer (2026-10-20, FRONT.pdf)', () => {
  /**
   * The tenant group [1, 2], a highlight holding story 1 too (D-111) and story 100, and a second
   * highlight not read yet (its lazy read is what re-runs the surface's merge below).
   */
  function sharedGroups(): StoryGroupView[] {
    const [tenant, highlight] = groups([false, false]) as [StoryGroupView, StoryGroupView];
    return [
      tenant,
      { ...highlight, items: [item(1, false), item(100, false)] },
      {
        ...highlight,
        key: 'h2',
        highlightId: '0000000a-1111-4111-8111-222222222222',
        name: 'Aulas',
        items: null,
      },
    ];
  }

  it('S9. the story leaves EVERY group at once, and the route is refreshed ONCE, after the viewer closes', async () => {
    render(
      <StoriesSurface
        circles={circles}
        regionLabel="Stories"
        viewer={{
          groups: sharedGroups(),
          labels: {} as StoryViewerLabelsView,
          onLike: vi.fn(),
          onUnlike: vi.fn(),
        }}
      />,
    );
    openTenant();
    const before = host.props?.groups;

    act(() => host.props?.onStoryDeleted?.(id(1)));
    const ids = (g: number) => host.props?.groups[g]?.items?.map((entry) => entry.id);
    expect(ids(0)).toEqual([id(2)]);
    expect(ids(1)).toEqual([id(100)]);
    // Not while the viewer is open: the URL on screen is still the deleted story's own.
    expect(router.refresh).not.toHaveBeenCalled();

    // Another group changing (a lazy read that fails) re-runs the merge, and the filtered groups
    // keep their identity: the host keys its built items, and so its mounted media, on them.
    const after = host.props?.groups;
    expect(after?.[0]).not.toBe(before?.[0]);
    await act(async () => {
      host.props?.onNeedGroup?.(2);
      await Promise.resolve();
    });
    expect(host.props?.groups[2]?.failed).toBe(true);
    expect(host.props?.groups[0]).toBe(after?.[0]);
    expect(host.props?.groups[1]).toBe(after?.[1]);

    close();
    await settle();
    expect(router.refresh).toHaveBeenCalledTimes(1);

    // Another open and close is not another refresh.
    openTenant();
    close();
    await settle();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('S10. the share reaches the host, and the strip takes the desktop arrows’ names', () => {
    const share = { origin: 'https://rede-demo.localhost', title: 'Rede Demo' };
    render(
      <StoriesSurface
        circles={circles}
        regionLabel="Stories"
        scrollLabels={{ previous: 'Voltar na fileira', next: 'Avançar na fileira' }}
        viewer={{
          groups: groups([false]),
          labels: {} as StoryViewerLabelsView,
          onLike: vi.fn(),
          onUnlike: vi.fn(),
          share,
        }}
      />,
    );
    // The row renders as before (happy-dom does no layout, so it never overflows: no arrow).
    expect(screen.getByRole('list', { name: 'Stories' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Avançar na fileira' })).toBeNull();

    openTenant();
    expect(host.props?.share).toEqual(share);
    expect(typeof host.props?.onStoryDeleted).toBe('function');
  });
});
