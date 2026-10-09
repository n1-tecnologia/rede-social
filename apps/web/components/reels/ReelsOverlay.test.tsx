// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReelView } from '@/lib/reels';
import type { ReelsHostProps } from './ReelsHost';
import type { ReelsOverlayBinding, ReelsOverlayProps } from './ReelsOverlay';

/**
 * 2026-10-09 — the dialog a single tap on a feed video opens: a modal named like the stage, over the
 * shell's chrome, with the shipped focus trap. Focus lands on the return arrow (not on the first stop
 * of the pager) and lands there again when the host is remounted with the start page; Escape is the
 * way back; Tab stays inside.
 *
 * The HOST is a stand-in: it records the props the overlay hands it and draws the return arrow (with
 * the real host's `data-reels-back`) after another control, so the first focusable is NOT the arrow.
 * `ReelsHost.test.tsx` covers the host itself in its overlay variant.
 */

const { hosts } = vi.hoisted(() => ({
  /** Every props object a host instance rendered with, and the instance that rendered it. */
  hosts: [] as { props: ReelsHostProps; instance: number }[],
}));

vi.mock('./ReelsHost', async () => {
  const { useRef } = await import('react');
  let instances = 0;
  return {
    REELS_ALL_LANE: 'all',
    ReelsHost: function ReelsHostStandIn(props: ReelsHostProps) {
      const instance = useRef(0);
      if (instance.current === 0) {
        instances += 1;
        instance.current = instances;
      }
      hosts.push({ props, instance: instance.current });
      return (
        <div data-testid="host" data-instance={instance.current}>
          <button type="button">first-stop</button>
          <button
            type="button"
            data-reels-back=""
            aria-label={props.backLabel}
            onClick={props.onBack}
          >
            back
          </button>
        </div>
      );
    },
  };
});

const { ReelsOverlay } = await import('./ReelsOverlay');

const BINDING: ReelsOverlayBinding = {
  canPost: false,
  locale: 'pt-BR',
  tenantName: 'Rede Demo',
  onLike: vi.fn(),
  onUnlike: vi.fn(),
  comments: {} as ReelsOverlayBinding['comments'],
  labels: { region: 'region-label' } as ReelsOverlayBinding['labels'],
  backLabel: 'back-label',
};

function view(n: number): ReelView {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    caption: '',
    shareUrl: null,
    author: { displayName: `author-${n}`, profileHref: `/membros/m${n}`, avatarUrl: null },
    community: null,
    likeCount: 0,
    commentCount: 0,
    viewerLiked: false,
    video: { assetId: `asset-${n}`, width: null, height: null },
  };
}

function overlay(overrides: Partial<ReelsOverlayProps> = {}) {
  const props: ReelsOverlayProps = {
    binding: BINDING,
    start: { status: 'loading' },
    onBack: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
  const result = render(<ReelsOverlay {...props} />);
  return { props, ...result };
}

const dialog = () => screen.getByRole('dialog', { name: 'region-label' });
const back = () => screen.getByRole('button', { name: 'back-label' });
const lastHost = () => {
  const last = hosts.at(-1);
  if (!last) throw new Error('no host rendered');
  return last;
};

beforeEach(() => {
  hosts.length = 0;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ReelsOverlay — the dialog (2026-10-09)', () => {
  it('is a modal dialog named like the stage, full screen over the shell, hiding its chrome', () => {
    overlay();
    const root = dialog();
    expect(root.getAttribute('aria-modal')).toBe('true');
    expect(root.getAttribute('data-shell-hide')).toBe('chrome');
    for (const cls of ['fixed', 'inset-0', 'z-[52]', 'bg-black']) {
      expect(root.classList.contains(cls)).toBe(true);
    }
  });

  it('focus lands on the return arrow, not on the first stop inside', () => {
    overlay();
    expect(document.activeElement).toBe(back());
  });

  it('Escape is the way back', () => {
    const { props } = overlay();
    fireEvent.keyDown(back(), { key: 'Escape' });
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it('Tab stays inside: from the last stop it wraps to the first', () => {
    overlay();
    back().focus();
    fireEvent.keyDown(back(), { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first-stop' }));
  });

  it('while loading the host shows its loading state, with no page and the way back', () => {
    const { props } = overlay();
    const { props: host } = lastHost();
    expect(host.pending).toBe(true);
    expect(host.initial).toBeNull();
    expect(host.onBack).toBe(props.onBack);
    expect(host.backLabel).toBe('back-label');
    expect(host.onRetry).toBe(props.onRetry);
    // No lane row: the overlay continues one lane, "Todos" by default.
    expect(host.lanes).toEqual([]);
    expect(host.initialLane).toBe('all');
  });

  it('the start page seeds a NEW host at the tapped video, in its lane, and focus follows the arrow', async () => {
    const items = [view(1), view(2), view(3)];
    const { rerender, props } = overlay({ lane: 'c1' });
    const loadingInstance = lastHost().instance;

    await act(async () => {
      rerender(
        <ReelsOverlay
          {...props}
          lane="c1"
          start={{ status: 'ready', items, nextCursor: 'next', index: 2 }}
        />,
      );
    });

    const { props: host, instance } = lastHost();
    expect(instance).not.toBe(loadingInstance);
    expect(host.pending).toBe(false);
    expect(host.initial).toEqual({ items, nextCursor: 'next' });
    expect(host.initialIndex).toBe(2);
    expect(host.initialLane).toBe('c1');
    expect(document.activeElement).toBe(back());
  });

  it('an unreadable start is the host’s stage error, whose retry is the overlay’s', () => {
    const { props } = overlay({ start: { status: 'error' } });
    const { props: host } = lastHost();
    expect(host.pending).toBe(false);
    expect(host.initial).toBeNull();
    host.onRetry?.();
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it('hands the host the binding and the interaction report', () => {
    const onInteraction = vi.fn();
    overlay({ onInteraction });
    const { props: host } = lastHost();
    expect(host.labels).toBe(BINDING.labels);
    expect(host.tenantName).toBe('Rede Demo');
    expect(host.onInteraction).toBe(onInteraction);
  });
});
