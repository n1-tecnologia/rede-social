// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LikeButton, type LikeButtonProps } from '../ui/LikeButton';

/**
 * D-124: `LikeButton` gains an opt-in over-media tone for the Reels rail. The DEFAULT tone must
 * render exactly as before, so the feed cards and the story viewer are unchanged; `overMedia` is a
 * white stroke idle and the like colour liked, with no descendant override that would repaint a
 * liked heart white.
 */

afterEach(() => {
  cleanup();
});

function props(overrides: Partial<LikeButtonProps> = {}): LikeButtonProps {
  return {
    liked: false,
    countLabel: null,
    likeLabel: 'like-label',
    unlikeLabel: 'unlike-label',
    pulseKey: 0,
    onToggle: vi.fn(),
    ...overrides,
  };
}

function glyph(button: HTMLElement): SVGElement {
  const svg = button.querySelector('svg');
  if (!svg) throw new Error('no glyph');
  return svg;
}

describe('LikeButton — the default tone is unchanged (D-124)', () => {
  it('unliked: text-text, a 20 px glyph, data-like-state unliked', () => {
    render(<LikeButton {...props()} />);
    const button = screen.getByRole('button', { name: 'like-label' });
    expect(button.className).toContain('text-text');
    expect(button.className).not.toContain('text-white');
    expect(button).toHaveAttribute('data-like-state', 'unliked');
    expect(glyph(button).getAttribute('width')).toBe('20');
  });

  it('liked: text-like with the fill class, named by unlikeLabel', () => {
    render(<LikeButton {...props({ liked: true })} />);
    const button = screen.getByRole('button', { name: 'unlike-label' });
    expect(button.className).toContain('text-like');
    expect(button.className).toContain('[&_svg]:fill-like');
    expect(button).toHaveAttribute('data-like-state', 'liked');
  });
});

describe("LikeButton — tone='overMedia' (D-124, UI-D-87)", () => {
  it('unliked: text-white (not text-text) and the requested 28 px glyph', () => {
    render(<LikeButton {...props({ tone: 'overMedia', glyphSize: 28 })} />);
    const button = screen.getByRole('button', { name: 'like-label' });
    expect(button.className).toContain('text-white');
    expect(button.className).not.toContain('text-text');
    expect(glyph(button).getAttribute('width')).toBe('28');
    expect(button).toHaveAttribute('data-like-state', 'unliked');
  });

  it('liked: text-like with the fill class, and no descendant white override', () => {
    render(<LikeButton {...props({ tone: 'overMedia', glyphSize: 28, liked: true })} />);
    const button = screen.getByRole('button', { name: 'unlike-label' });
    expect(button.className).toContain('text-like');
    expect(button.className).toContain('[&_svg]:fill-like');
    expect(button.className).not.toContain('text-white');
    expect(button).toHaveAttribute('data-like-state', 'liked');
  });

  it('the glyph carries the over-video drop shadow', () => {
    render(<LikeButton {...props({ tone: 'overMedia' })} />);
    const button = screen.getByRole('button', { name: 'like-label' });
    expect(button.className).toContain('[&_svg]:drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]');
  });

  it('data-like-state flips with liked and a click calls onToggle once', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<LikeButton {...props({ tone: 'overMedia', onToggle })} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<LikeButton {...props({ tone: 'overMedia', onToggle, liked: true })} />);
    expect(screen.getByRole('button')).toHaveAttribute('data-like-state', 'liked');
  });

  it('keeps the polite sr-only count region', () => {
    const { container } = render(
      <LikeButton {...props({ tone: 'overMedia', countLabel: 'count-label' })} />,
    );
    const region = container.querySelector('[data-like-count]');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('count-label');
  });
});
