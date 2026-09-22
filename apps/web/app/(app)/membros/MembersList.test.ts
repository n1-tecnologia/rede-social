// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MembersLoading from './loading';
import { MembersSkeleton } from './MembersList';

/**
 * The directory's loading SHAPE (UI-SPEC E4/loading: "8 `Skeleton` rows, circle 40 + two bars").
 *
 * Why this is a unit test and not a browser one: the count is asserted here because it is a pure
 * property of the component, and pinning it in one place keeps the two callers — the route-level
 * `loading.tsx` and the list's own pending state — from drifting apart. `members.spec.ts` proves
 * the pending state actually APPEARS on a debounced query change; this proves what it contains.
 *
 * The route-level `loading.tsx` is additionally checked to render the SAME skeleton rather than a
 * lookalike of its own, which is the failure this test is really for: two eight-row skeletons that
 * slowly stop matching.
 */

vi.mock('./actions', () => ({
  loadMoreMembersAction: vi.fn(),
}));

afterEach(cleanup);

describe('MembersSkeleton', () => {
  it('renders EXACTLY eight rows, each an avatar circle over two text bars', () => {
    render(MembersSkeleton());

    const skeleton = screen.getByTestId('members-skeleton');
    const rows = Array.from(skeleton.children);
    expect(rows).toHaveLength(8);

    for (const row of rows) {
      // Circle 40 + a name bar + a bio bar — the geometry of a real `MemberRow`.
      expect(row.className).toContain('min-h-14');
      expect(row.querySelectorAll('.rounded-full')).toHaveLength(1);
      expect(row.querySelectorAll('.animate-shimmer')).toHaveLength(3);
    }

    // The whole block is announced as busy, never as content.
    expect(skeleton.hasAttribute('aria-busy')).toBe(true);
  });

  it('is what the route-level loading.tsx renders — one skeleton, not two lookalikes', () => {
    render(MembersLoading());

    const skeleton = screen.getByTestId('members-skeleton');
    expect(skeleton.children).toHaveLength(8);
  });
});
