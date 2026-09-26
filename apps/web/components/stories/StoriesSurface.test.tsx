// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markStoriesSeenAction } from '@/app/(app)/stories/story-actions';
import type {
  RowCircleView,
  StoryGroupView,
  StoryViewerItemView,
  StoryViewerLabelsView,
} from '@/lib/story-view';
import { StoriesSurface } from './StoriesSurface';

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
 *  - S4: every flush trigger, one call each, and an id already sent is never sent again;
 *  - S5: a failed flush is logged and swallowed — no toast, no navigation, the viewer stays.
 *
 * The viewer host is STUBBED: it records the props the surface hands it and exposes the two
 * callbacks the surface owns (`onSegmentShown`, `onClose`). The strip and its circles are REAL, so
 * the ring class and the accessible name are asserted on the rendered control.
 */

type HostProps = {
  initialGroup: number;
  initialIndex: number;
  onClose?: () => void;
  onSegmentShown?: (storyId: string, groupKey: string) => void;
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

function renderSurface(flags: boolean[]) {
  return render(
    <StoriesSurface
      circles={circles}
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

beforeEach(() => {
  host.props = null;
  vi.mocked(markStoriesSeenAction).mockReset();
  vi.mocked(markStoriesSeenAction).mockResolvedValue(true);
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

    // visibilitychange → hidden flushes what is pending.
    vi.mocked(markStoriesSeenAction).mockClear();
    renderSurface([false, false]);
    openTenant();
    shown(1);
    act(() => setVisibility('hidden'));
    expect(calls()).toEqual([[id(1)]]);
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
});
