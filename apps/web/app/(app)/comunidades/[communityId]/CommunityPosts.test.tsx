// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 10-14 Task 2 (UI-D-717) — a like on a community post that has just vanished (a blocked or departed
 * creator makes the API answer the bare 404) reverts, shows the shipped generic error toast (the list's
 * own `onLikeError`) and refreshes the page, which then resolves to the shipped not-found screen. A
 * refusal that carries a code of its own (`community_locked`, `follow_required`) is NOT a vanished
 * community and does not refresh.
 */

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  surfaceProps: null as Record<string, unknown> | null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: mocks.refresh }),
}));
vi.mock('@/components/feed/FeedSurface', () => ({
  FeedSurface: (props: Record<string, unknown>) => {
    mocks.surfaceProps = props;
    return null;
  },
}));

const { CommunityPosts } = await import('./CommunityPosts');

type Outcome = { ok: true; liked: boolean; likeCount: number } | { ok: false; code?: string };

function mount(onLike: (id: string) => Promise<Outcome>, onUnlike = onLike) {
  // biome-ignore lint/suspicious/noExplicitAny: a partial prop bag, the list is mocked
  render(<CommunityPosts {...({ onLike, onUnlike, initialItems: [] } as any)} />);
  return mocks.surfaceProps as unknown as {
    onLike: (id: string) => Promise<Outcome>;
    onUnlike: (id: string) => Promise<Outcome>;
  };
}

beforeEach(() => {
  mocks.refresh.mockClear();
  mocks.surfaceProps = null;
});
afterEach(cleanup);

describe('CommunityPosts — a like on vanished content refreshes the page (UI-D-717)', () => {
  it('V1. a generic failure of like or unlike returns the failure untouched and refreshes once each', async () => {
    const failing = vi.fn(async (): Promise<Outcome> => ({ ok: false, code: 'generic' }));
    const props = mount(failing);

    expect(await props.onLike('p1')).toEqual({ ok: false, code: 'generic' });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(await props.onUnlike('p1')).toEqual({ ok: false, code: 'generic' });
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it('V2. a success is passed through and never refreshes', async () => {
    const props = mount(async () => ({ ok: true, liked: true, likeCount: 3 }));

    expect(await props.onLike('p1')).toEqual({ ok: true, liked: true, likeCount: 3 });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('V3. a refusal with its own code (locked, follow required) does not refresh', async () => {
    const props = mount(async () => ({ ok: false, code: 'community_locked' }));

    await props.onLike('p1');
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
