// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { ToastProvider } from '@rede-social/ui';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedList, type FeedListProps } from '../ui/FeedList';
import type { PostMenuLabels } from '../ui/PostMenu';

/**
 * 10-11 (UI-D-509, Pitfall 11, MCOMM-08): the post menu's wording follows the AUTHOR KIND, not the
 * `'followers'` literal alone. A post stamped `'community'` is a member's too (the creator's), so its
 * author's delete confirmation uses the member body; an organization post (`'tenant'`, or no key on the
 * wire) keeps the organization body. Sentinel ASCII strings throughout.
 */

vi.mock('motion/react', async () => {
  const { createElement, forwardRef } = await import('react');
  const MOTION_ONLY = new Set(['initial', 'animate', 'exit', 'transition', 'variants', 'layout']);
  const cache = new Map<string, unknown>();
  const proxy = new Proxy(
    {},
    {
      get: (_target, tag: string) => {
        const cached = cache.get(tag);
        if (cached) return cached;
        const component = forwardRef((props: Record<string, unknown>, ref: unknown) => {
          const plain: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(props)) {
            if (!MOTION_ONLY.has(key)) plain[key] = value;
          }
          return createElement(tag, { ...plain, ref });
        });
        cache.set(tag, component);
        return component;
      },
    },
  );
  return {
    motion: proxy,
    AnimatePresence: ({ children }: { children?: unknown }) => children,
    useReducedMotion: () => true,
  };
});

afterEach(cleanup);

const MENU_LABELS: PostMenuLabels = {
  edit: 'edit-label',
  copyLink: 'copy-link-label',
  delete: 'delete-label',
  deleteTitle: 'delete-title',
  deleteBody: 'delete-body-org',
  deleteBodyMember: 'delete-body-member',
  deleteConfirm: 'delete-confirm',
  deleteCancel: 'delete-cancel',
  remove: 'remove-label',
  removeTitle: 'remove-title',
  removeBody: 'remove-body',
  removeConfirm: 'remove-confirm',
  removeCancel: 'remove-cancel',
};

const ok = async () => ({ ok: true as const, liked: true, likeCount: 1 });

function listProps(overrides: Partial<FeedListProps> = {}): FeedListProps {
  return {
    initialItems: [],
    initialCursor: null,
    canPost: false,
    captionTruncateAt: 200,
    locale: 'pt-BR',
    labels: {
      region: 'region-label',
      more: 'more-label',
      carousel: 'carousel-label',
      attachmentError: 'attachment-error',
      like: 'like-label',
      unlike: 'unlike-label',
      comment: 'comment-label',
      share: 'share-label',
      moreOptions: 'more-options-label',
      likes: { one: '{count}-like', other: '{count}-likes' },
      comments: { one: '{count}-comment', other: '{count}-comments' },
      edited: 'edited-label',
      emptyTitle: 'empty-title',
      emptyBody: 'empty-body',
      emptyBodyAuthor: 'empty-body-author',
      emptyCta: 'empty-cta',
      errorTitle: 'error-title',
      errorBody: 'error-body',
      errorRetry: 'error-retry',
      loadMoreError: 'load-more-error',
      loadMoreRetry: 'load-more-retry',
      createCta: 'create-cta',
      createFab: 'create-fab',
      genericError: 'generic-error',
    },
    onLoadMore: vi.fn(async () => ({ ok: false as const })),
    onRefresh: vi.fn(async () => ({ ok: false as const })),
    onLike: ok,
    onUnlike: ok,
    ...overrides,
  };
}

function item(audience?: 'tenant' | 'followers' | 'community') {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    caption: 'caption-1',
    author: { displayName: 'author-1', profileHref: '/membros/m1', avatarUrl: null },
    createdAtIso: '2026-10-08T10:00:00.000Z',
    createdAtRelative: 'relative-time',
    createdAtAbsolute: 'absolute-time',
    community: null,
    shareUrl: null,
    edited: false,
    canManage: true,
    editHref: '/post/1/editar',
    likeCount: 0,
    commentCount: 0,
    viewerLiked: false,
    ariaLabel: 'post-1',
    media: { mediaKind: 'none' as const, images: [], attachments: [] },
    ...(audience ? { audience } : {}),
  };
}

function openDelete(audience?: 'tenant' | 'followers' | 'community') {
  render(
    <ToastProvider>
      <FeedList
        {...listProps({
          initialItems: [item(audience)],
          menu: { labels: MENU_LABELS, onDelete: vi.fn(async () => {}) },
        })}
      />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'more-options-label' }));
  fireEvent.click(screen.getByRole('button', { name: 'delete-label' }));
}

describe('FeedList - the delete wording follows the author kind (10-11)', () => {
  it('an organization post (no audience key, or tenant) keeps the organization body', () => {
    openDelete();
    expect(screen.getByText('delete-body-org')).toBeInTheDocument();
    cleanup();
    openDelete('tenant');
    expect(screen.getByText('delete-body-org')).toBeInTheDocument();
  });

  it('a member post (followers) uses the member body', () => {
    openDelete('followers');
    expect(screen.getByText('delete-body-member')).toBeInTheDocument();
  });

  it('a member-community post (community) is a member post too: the member body', () => {
    openDelete('community');
    expect(screen.getByText('delete-body-member')).toBeInTheDocument();
    expect(screen.queryByText('delete-body-org')).toBeNull();
  });
});
