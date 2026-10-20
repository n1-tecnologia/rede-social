// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FollowButton, type FollowButtonLabels } from '../ui/FollowButton';

/**
 * 09-10 (UI-D-498, D-470): the props-only Seguir / Seguindo button. The module ships no language, so
 * every string below is a sentinel the host would pass. The claims: the two looks (brand when not
 * following, outline when following), the pending state is the shipped `loading` prop (spinner,
 * `aria-busy`, disabled, label kept), the accessible name is the host's string and contains the
 * visible text, the `sm` row geometry is a fixed `w-24`, and the button renders no text of its own.
 */

afterEach(cleanup);

const LABELS: FollowButtonLabels = {
  follow: 'follow-label',
  following: 'following-label',
  ariaFollow: 'follow-label of Ana',
  ariaFollowing: 'following-label of Ana, tap to leave',
};

function renderButton(props: Partial<React.ComponentProps<typeof FollowButton>> = {}) {
  const onToggle = vi.fn();
  render(
    <FollowButton following={false} size="md" labels={LABELS} onToggle={onToggle} {...props} />,
  );
  return { onToggle, button: screen.getByRole('button') as HTMLButtonElement };
}

describe('FollowButton', () => {
  it('B1: not following is the brand button named by the follow aria string', () => {
    const { button } = renderButton();
    expect(button.textContent).toBe(LABELS.follow);
    expect(button.getAttribute('aria-label')).toBe(LABELS.ariaFollow);
    expect(button.className).toContain('bg-button');
    expect(button.className).not.toContain('border-border-secondary');
  });

  it('B2: following is the outline button named by the following aria string', () => {
    const { button } = renderButton({ following: true });
    expect(button.textContent).toBe(LABELS.following);
    expect(button.getAttribute('aria-label')).toBe(LABELS.ariaFollowing);
    expect(button.className).toContain('border-border-secondary');
    expect(button.className).not.toContain('bg-button');
  });

  it('B3: both accessible names contain the visible text (WCAG 2.5.3)', () => {
    for (const following of [false, true]) {
      cleanup();
      const { button } = renderButton({ following });
      expect(button.getAttribute('aria-label')).toContain(button.textContent ?? '#');
    }
  });

  it('B4: pending sets aria-busy, disables the button, keeps the label and shows the spinner', () => {
    const { button, onToggle } = renderButton({ following: true, pending: true });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe(LABELS.following);
    expect(button.querySelector('svg.animate-spin')).not.toBeNull();
    fireEvent.click(button);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('B5: idle carries no aria-busy and a tap calls onToggle once', () => {
    const { button, onToggle } = renderButton();
    expect(button.hasAttribute('aria-busy')).toBe(false);
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('B6: the sm row button is a fixed w-24 that never shrinks, with the 44px hit area', () => {
    const { button } = renderButton({ size: 'sm' });
    expect(button.className).toContain('w-24');
    expect(button.className).toContain('shrink-0');
    expect(button.className).toContain('after:');
  });

  it('B7: the md profile button can be full width and carries no fixed row width', () => {
    const { button } = renderButton({ size: 'md', fullWidth: true });
    expect(button.className).toContain('w-full');
    expect(button.className).not.toContain('w-24');
  });

  it('B8: a caller className merges last (the profile caps it on desktop)', () => {
    const { button } = renderButton({ size: 'md', fullWidth: true, className: 'md:max-w-[400px]' });
    expect(button.className).toContain('md:max-w-[400px]');
  });
});
