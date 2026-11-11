// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadStoryAuthorsPageAction } from '@/app/(app)/stories/story-actions';
import type { StoriesSurfaceProps } from '@/components/stories/StoriesSurface';
import { type AuthorRowLabels, moderatorStoriesRow } from '@/lib/story-view';
import { ExplorarStoriesRow } from './ExplorarStoriesRow';

/**
 * 10-12 (UI-D-699): the moderator's PAGED row. The row's state machine is what is under test, so the
 * surface is stubbed to a recorder of the props it is handed (`circles`, `onReachEnd`, `loadingMore`,
 * `retry`, `viewer.groups`): the strip's own scroll hook has its cases in the module, and the
 * member's lazy groups have theirs in `StoriesSurface.test.tsx`.
 *
 *  - the first page is the server's; `onReachEnd` exists only while there is a next cursor;
 *  - one request at a time, with the three trailing skeleton circles while it loads;
 *  - the page lands AFTER the loaded circles, a membership already in the row is dropped, the groups
 *    number on, and the cursor moves;
 *  - a failed page leaves the loaded circles and one trailing "Recarregar" circle whose action asks
 *    for the SAME cursor again.
 */

const surface: { props: StoriesSurfaceProps | null } = { props: null };

vi.mock('@/components/stories/StoriesSurface', () => ({
  StoriesSurface: (props: StoriesSurfaceProps) => {
    surface.props = props;
    return <div data-testid="surface" />;
  },
}));

vi.mock('@/app/(app)/stories/story-actions', () => ({
  loadStoryAuthorsPageAction: vi.fn(),
}));

const LABELS: AuthorRowLabels = {
  ownLabel: 'Seu story',
  ownAction: 'Publicar um story',
  ownOpen: 'Abrir seus stories',
  author: 'Abrir stories de {name}',
  authorUnseen: 'Abrir stories de {name}. Há stories novos.',
};
const RETRY = {
  label: 'Recarregar',
  actionLabel: 'Não foi possível carregar mais stories. Tentar novamente.',
};

function author(n: number) {
  return {
    membershipId: `0e000000-0000-4000-8000-00000000000${n}`,
    displayName: `Pessoa ${n}`,
    avatarUrl: null,
    storyCount: 1,
    latestPublishedAt: '2026-11-11T12:00:00.000000Z',
    hasUnseen: n % 2 === 0,
    isSelf: false,
  };
}
const item = ({ membershipId, displayName, avatarUrl, hasUnseen }: ReturnType<typeof author>) => ({
  membershipId,
  displayName,
  avatarUrl,
  hasUnseen,
});

const VIEWER = { labels: {} as never, onLike: vi.fn(), onUnlike: vi.fn() };

function renderRow(nextCursor: string | null = 'c2') {
  const first = moderatorStoriesRow({ items: [author(1), author(2)], nextCursor }, LABELS);
  return render(
    <ExplorarStoriesRow
      circles={first.circles}
      groups={first.groups}
      regionLabel="Stories dos membros"
      scrollLabels={{ previous: 'a', next: 'b' }}
      viewer={VIEWER}
      paging={{ nextCursor: first.nextCursor, labels: LABELS, retry: RETRY }}
    />,
  );
}

const keys = () => surface.props?.circles.map((circle) => circle.key.slice(-1));
const groupCount = () => surface.props?.viewer?.groups.length;

beforeEach(() => {
  surface.props = null;
  vi.mocked(loadStoryAuthorsPageAction).mockReset();
});
afterEach(cleanup);

describe('ExplorarStoriesRow — the moderator row pages 20 at a time (10-12, UI-D-699)', () => {
  it('P1. the first page is the server’s, and the row asks for more only while a cursor exists', () => {
    renderRow('c2');
    expect(keys()).toEqual(['1', '2']);
    expect(surface.props?.regionLabel).toBe('Stories dos membros');
    expect(surface.props?.onReachEnd).toBeTypeOf('function');
    expect(surface.props?.loadingMore).toBeFalsy();
    expect(surface.props?.retry).toBeUndefined();
    cleanup();
    renderRow(null);
    expect(surface.props?.onReachEnd).toBeUndefined();
  });

  it('P2. reaching the end reads the next page: three skeletons while it loads, then the circles are appended after the loaded ones, de-duplicated, groups numbered on, the cursor moved', async () => {
    let release: (value: Awaited<ReturnType<typeof loadStoryAuthorsPageAction>>) => void = () => {};
    vi.mocked(loadStoryAuthorsPageAction).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    renderRow('c2');
    act(() => surface.props?.onReachEnd?.());
    expect(loadStoryAuthorsPageAction).toHaveBeenCalledExactlyOnceWith('c2');
    expect(surface.props?.loadingMore).toBe(true);
    // A second reach while the first request is in flight does nothing.
    act(() => surface.props?.onReachEnd?.());
    expect(loadStoryAuthorsPageAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ ok: true, authors: [item(author(2)), item(author(3))], nextCursor: 'c3' });
    });
    expect(surface.props?.loadingMore).toBe(false);
    expect(keys()).toEqual(['1', '2', '3']);
    expect(
      surface.props?.circles.map((circle) => ('group' in circle ? circle.group : null)),
    ).toEqual([0, 1, 2]);
    expect(groupCount()).toBe(3);

    vi.mocked(loadStoryAuthorsPageAction).mockResolvedValueOnce({
      ok: true,
      authors: [item(author(4))],
      nextCursor: null,
    });
    await act(async () => surface.props?.onReachEnd?.());
    expect(loadStoryAuthorsPageAction).toHaveBeenLastCalledWith('c3');
    expect(keys()).toEqual(['1', '2', '3', '4']);
    // The last page ended the row: nothing more to ask for.
    expect(surface.props?.onReachEnd).toBeUndefined();
  });

  it('P3. a failed page keeps every loaded circle and adds ONE "Recarregar" retry that asks for the SAME cursor again', async () => {
    vi.mocked(loadStoryAuthorsPageAction).mockResolvedValueOnce({ ok: false });
    renderRow('c2');
    await act(async () => surface.props?.onReachEnd?.());
    expect(keys()).toEqual(['1', '2']);
    expect(surface.props?.loadingMore).toBe(false);
    expect(surface.props?.retry).toMatchObject(RETRY);

    vi.mocked(loadStoryAuthorsPageAction).mockResolvedValueOnce({
      ok: true,
      authors: [item(author(3))],
      nextCursor: null,
    });
    await act(async () => surface.props?.retry?.onRetry());
    expect(loadStoryAuthorsPageAction).toHaveBeenLastCalledWith('c2');
    expect(loadStoryAuthorsPageAction).toHaveBeenCalledTimes(2);
    expect(surface.props?.retry).toBeUndefined();
    expect(keys()).toEqual(['1', '2', '3']);
  });

  it('P4. a request that throws is the same failure, never an unhandled rejection', async () => {
    vi.mocked(loadStoryAuthorsPageAction).mockRejectedValueOnce(new Error('offline'));
    renderRow('c2');
    await act(async () => surface.props?.onReachEnd?.());
    expect(surface.props?.retry).toMatchObject(RETRY);
    expect(keys()).toEqual(['1', '2']);
  });

  it('P5. a row without paging (the member’s) never asks and never retries', () => {
    const member = moderatorStoriesRow({ items: [author(1)], nextCursor: null }, LABELS);
    render(
      <ExplorarStoriesRow
        circles={member.circles}
        groups={member.groups}
        regionLabel="Stories de quem você segue"
        scrollLabels={{ previous: 'a', next: 'b' }}
        viewer={VIEWER}
      />,
    );
    expect(surface.props?.onReachEnd).toBeUndefined();
    expect(surface.props?.retry).toBeUndefined();
    expect(surface.props?.loadingMore).toBeFalsy();
  });
});
