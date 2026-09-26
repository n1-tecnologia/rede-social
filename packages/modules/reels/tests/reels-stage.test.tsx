// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReelPlaybackError } from '../ui/ReelPlaybackError';
import { ReelsStage } from '../ui/ReelsStage';

/**
 * The two props-only pieces every Reels state renders with (UI-D-82, UI-D-93b, UI-D-97, UI-D-98).
 * Strings are sentinel ASCII: the module ships no words (PWA-03).
 */
afterEach(() => {
  cleanup();
});

describe('ReelsStage (UI-D-82, UI-D-97, UI-D-98)', () => {
  it('is a labelled region landmark, dark-scoped, fixed full-screen black under the BottomNav', () => {
    render(
      <ReelsStage label="stage-label">
        <p>child</p>
      </ReelsStage>,
    );
    const region = screen.getByRole('region', { name: 'stage-label' });
    expect(region.tagName).toBe('SECTION');
    expect(region).toHaveAttribute('data-theme', 'dark');
    for (const cls of ['fixed', 'inset-0', 'z-40', 'overflow-hidden', 'bg-black', 'md:left-60']) {
      expect(region.className).toContain(cls);
    }
    expect(region.style.touchAction).toBe('none');
    expect(screen.getByText('child')).toBeInTheDocument();
  });
});

describe('ReelPlaybackError (UI-D-93b)', () => {
  it('renders the message and a retry pill that calls onRetry once', () => {
    const onRetry = vi.fn();
    render(<ReelPlaybackError message="error-label" retryLabel="retry-label" onRetry={onRetry} />);
    expect(screen.getByText('error-label')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'retry-label' });
    expect(retry.className).toContain('h-11');
    expect(retry.className).toContain('rounded-full');
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('is a SIZED block, never an absolute inset-0 sibling that would swallow swipes', () => {
    const { container } = render(
      <ReelPlaybackError message="error-label" retryLabel="retry-label" onRetry={vi.fn()} />,
    );
    const block = container.firstElementChild as HTMLElement;
    expect(block).not.toBeNull();
    expect(block.className).not.toContain('inset-0');
    expect(block.querySelector('svg')).not.toBeNull();
  });
});
