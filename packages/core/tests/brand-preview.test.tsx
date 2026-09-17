// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NEUTRAL_BRAND } from '@tria/contracts/branding';
import { afterEach, describe, expect, it } from 'vitest';
import { BrandPreview, type BrandPreviewLabels } from '../ui';

afterEach(() => {
  cleanup();
});

const labels: BrandPreviewLabels = {
  light: 'Claro',
  dark: 'Escuro',
  lightAria: 'Prévia do aplicativo no modo claro',
  darkAria: 'Prévia do aplicativo no modo escuro',
  login: 'Entrar',
};
const colors = { primary: '#7c3aed', secondary: '#a78bfa' };

/** `--brand-primary: #7c3aed` or `--brand-primary:#7c3aed` (serialisation of custom properties varies). */
const varRe = (name: string, value: string) => new RegExp(`${name}:\\s*${value}`);

describe('BrandPreview (UI-SPEC E12, D-25/D-26/D-41)', () => {
  it('renders exactly two [data-brand-scope] frames, light then dark, with the brand vars inline', () => {
    const { container } = render(
      <BrandPreview
        colors={colors}
        displayName="Associação São José"
        logoUrl={null}
        labels={labels}
      />,
    );
    const frames = container.querySelectorAll('[data-brand-scope]');
    expect(frames).toHaveLength(2);
    expect(frames[0]?.getAttribute('data-theme')).toBe('light');
    expect(frames[1]?.getAttribute('data-theme')).toBe('dark');
    for (const frame of frames) {
      const style = frame.getAttribute('style') ?? '';
      expect(style).toMatch(varRe('--brand-primary', '#7c3aed'));
      const dark = style.match(/--brand-primary-dark:\s*(#[0-9a-f]{6})/)?.[1];
      expect(dark).toBeTruthy();
      expect(dark).not.toBe('#7c3aed');
      expect(frame.getAttribute('role')).toBe('img');
    }
    expect(frames[0]?.getAttribute('aria-label')).toBe(labels.lightAria);
    expect(frames[1]?.getAttribute('aria-label')).toBe(labels.darkAria);
  });

  it('E12/empty: without a logo the display name renders as text in both frames and there is no <img>', () => {
    const { container } = render(
      <BrandPreview
        colors={colors}
        displayName="Associação São José"
        logoUrl={null}
        labels={labels}
      />,
    );
    // TopBar name + body name per frame → 4 occurrences; at least twice is the contract.
    expect(screen.getAllByText('Associação São José').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });

  it('never shows the TRIA mark nor the neutral fallback hex when colours are given', () => {
    const { container } = render(
      <BrandPreview
        colors={colors}
        displayName="Associação São José"
        logoUrl={null}
        labels={labels}
      />,
    );
    expect(screen.queryByText('TRIA', { exact: true })).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain(NEUTRAL_BRAND.primary);
  });

  it('E12/populated: with a logo it renders exactly two <img src=logo> (one per frame)', () => {
    const { container } = render(
      <BrandPreview
        colors={colors}
        displayName="Associação São José"
        logoUrl="https://x.test/logo.svg"
        labels={labels}
      />,
    );
    const imgs = Array.from(container.querySelectorAll('[data-brand-scope] img'));
    // TopBar + body per frame: four images, every one pointing at the given URL and nothing else.
    expect(imgs).toHaveLength(4);
    expect(imgs.every((img) => img.getAttribute('src') === 'https://x.test/logo.svg')).toBe(true);
    // Each frame carries the logo in its TopBar (alt = displayName) — exactly two of those.
    expect(container.querySelectorAll('img[alt="Associação São José"]')).toHaveLength(2);
    expect(container.querySelectorAll('img')).toHaveLength(4);
  });

  it('renders children once below the grid and the login CTA as a brand Button in each frame', () => {
    const { container } = render(
      <BrandPreview colors={colors} displayName="X" logoUrl={null} labels={labels}>
        <p>readout</p>
      </BrandPreview>,
    );
    expect(screen.getAllByText('readout')).toHaveLength(1);
    expect(container.querySelectorAll('[data-brand-scope] button')).toHaveLength(2);
    expect(screen.getAllByText('Entrar')).toHaveLength(2);
  });
});
