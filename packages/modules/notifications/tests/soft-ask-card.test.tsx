// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SoftAskCard, type SoftAskCardProps } from '../ui/SoftAskCard';

/**
 * UI-D-255 as observable contract (sketch 007 surface 3). Sentinel ASCII props only: the module ships
 * no words, so the rendered text is exactly the props.
 */

afterEach(cleanup);

function card(overrides: Partial<SoftAskCardProps> = {}) {
  const props: SoftAskCardProps = {
    title: 'title-sentinel',
    body: 'body-sentinel',
    cta: 'cta-sentinel',
    dismissLabel: 'dismiss-sentinel',
    onActivate: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  return { ...render(<SoftAskCard {...props} />), props };
}

describe('SoftAskCard (UI-D-255)', () => {
  it('renders the title, body, CTA and dismiss, and ships no words of its own', () => {
    const { container } = card();
    expect(screen.getByText('title-sentinel')).toBeInTheDocument();
    expect(screen.getByText('body-sentinel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'cta-sentinel' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'dismiss-sentinel' })).toBeEnabled();
    expect(container.textContent).toBe('title-sentinelbody-sentinelcta-sentinel');
  });

  it('the title and body wrap inside min-w-0 flex-1 and the dismiss sits in the corner', () => {
    const { container } = card();
    const root = container.querySelector('[data-push-softask]');
    expect(root).toHaveClass('mx-4', 'mt-4', 'p-4', 'flex', 'items-start', 'gap-3');
    const column = screen.getByText('title-sentinel').parentElement;
    expect(column).toHaveClass('min-w-0', 'flex-1');
    expect(screen.getByRole('button', { name: 'dismiss-sentinel' })).toHaveClass('-mt-2', '-mr-2');
    expect(screen.getByRole('button', { name: 'cta-sentinel' })).not.toHaveClass('w-full');
  });

  it('CTA and dismiss call their handlers', () => {
    const { props } = card();
    fireEvent.click(screen.getByRole('button', { name: 'cta-sentinel' }));
    fireEvent.click(screen.getByRole('button', { name: 'dismiss-sentinel' }));
    expect(props.onActivate).toHaveBeenCalledTimes(1);
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('busy shows loading on the CTA and disables both controls', () => {
    const { props } = card({ busy: true });
    const cta = screen.getByRole('button', { name: 'cta-sentinel' });
    expect(cta).toHaveAttribute('aria-busy', 'true');
    expect(cta).toBeDisabled();
    const dismiss = screen.getByRole('button', { name: 'dismiss-sentinel' });
    expect(dismiss).toBeDisabled();
    fireEvent.click(cta);
    fireEvent.click(dismiss);
    expect(props.onActivate).not.toHaveBeenCalled();
    expect(props.onDismiss).not.toHaveBeenCalled();
  });

  it('leaving fades to opacity 0 (instant under reduced motion)', () => {
    const { container } = card({ leaving: true });
    expect(container.querySelector('[data-push-softask]')).toHaveClass(
      'opacity-0',
      'duration-150',
      'motion-reduce:transition-none',
    );
  });
});
