// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StoriesBand } from './StoriesBand';

/**
 * The Início stories band (the REINE timeline, 2026-10-02) and, since 2026-10-20 (the client's
 * FRONT.pdf: rounded corners on the white box of the stories bar), its desktop card. The claims are
 * class-level because the shape is Tailwind's: the phone keeps the edge-to-edge band with its
 * hairline; `desktopCard` adds the card's corners, shadow and dark-theme border from `md` up only.
 */

afterEach(cleanup);

const band = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-stories-band]') as HTMLElement;

describe('StoriesBand', () => {
  it('1. without desktopCard it is the edge-to-edge band with its hairline, on every screen', () => {
    const { container } = render(
      <StoriesBand>
        <span data-testid="row" />
      </StoriesBand>,
    );
    const node = band(container);
    expect(node.className).toContain('border-b');
    expect(node.className).toContain('bg-card');
    expect(node.className).not.toContain('md:rounded-xl');
    expect(node.hasAttribute('data-desktop-card')).toBe(false);
    expect(node.querySelector('[data-testid="row"]')).not.toBeNull();
  });

  it('2. with desktopCard the box is a rounded card from md up, and still the band on a phone', () => {
    const { container } = render(
      <StoriesBand desktopCard>
        <span />
      </StoriesBand>,
    );
    const node = band(container);
    expect(node.hasAttribute('data-desktop-card')).toBe(true);
    const classes = node.className.split(/\s+/);
    // The phone's band, unchanged…
    expect(classes).toContain('border-b');
    expect(classes).toContain('bg-card');
    // …and the desktop card, every part of it behind `md:`.
    for (const name of [
      'md:rounded-xl',
      'md:border-b-0',
      'md:shadow-[0_1px_3px_rgba(22,35,59,.06)]',
      'md:dark:border',
      'md:dark:border-border',
    ]) {
      expect(classes).toContain(name);
    }
    expect(classes).not.toContain('rounded-xl');
  });
});
