import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * tokens.css is the single place where hex literals may live and the seam between the tenant's
 * `--brand-*` variables (set server-side by the layouts) and Tailwind utilities (`bg-brand`, ...).
 * These assertions pin the contract the rest of the phase depends on (UI-01, D-25, D-41).
 */
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/styles/tokens.css'), 'utf8');

/** Returns the body of the first `selector { ... }` block (no nested braces expected). */
function block(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `selector ${selector} present`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

describe('tokens.css — dark variant and @theme inline aliases', () => {
  it('declares the data-theme dark variant', () => {
    expect(css).toContain('@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *))');
  });

  it('binds brand utilities to the runtime --brand-accent pair through @theme inline', () => {
    expect(css).toContain('@theme inline');
    const theme = block('@theme inline');
    expect(theme).toContain('--color-brand: var(--brand-accent)');
    expect(theme).toContain('--color-on-brand: var(--brand-on-accent)');
    expect(theme).toContain('--color-brand-soft: var(--brand-primary-soft)');
    expect(theme).toContain('--color-brand-hover: var(--brand-primary-hover)');
    expect(theme).toContain('--font-sans: var(--font-manrope)');
    for (const alias of [
      '--color-bg',
      '--color-bg-secondary',
      '--color-bg-tertiary',
      '--color-bg-input',
      '--color-bg-hover',
      '--color-bg-active',
      '--color-card',
      '--color-card-hover',
      '--color-text',
      '--color-text-secondary',
      '--color-text-tertiary',
      '--color-text-inverse',
      '--color-border',
      '--color-border-secondary',
      '--color-divider',
      '--color-handle',
      '--color-success',
      '--color-danger',
      '--color-warning',
      '--color-info',
    ]) {
      expect(theme, `${alias} aliased`).toContain(`${alias}:`);
    }
  });
});

describe('tokens.css — neutral fallback brand and the two theme layers', () => {
  it('carries the neutral TRIA brand fallback and the light neutrals on :root (and explicit light scopes)', () => {
    const root = block(':root');
    expect(root).toContain('--brand-primary: #2e6fd0');
    expect(root).toContain('--brand-secondary: #5b9cf8');
    expect(root).toContain('--brand-on-primary: #ffffff');
    expect(root).toContain('--brand-primary-dark: #5b9cf8');
    expect(root).toContain('--brand-on-primary-dark: #0f1118');
    expect(root).toContain('--theme-bg: #f5f7fb');
    // 02-14: a light frame nested in a dark page re-applies the light neutrals.
    expect(css).toContain(':root,\n[data-theme="light"] {');
  });

  /**
   * 02-14 (D-25/D-41): a `var()` inside a custom property substitutes where the property is
   * DECLARED, so the derived aliases must be declared on every brand scope — :root, the AppShell
   * root, the BrandPreview frames and any element carrying inline `--brand-*` — not on :root alone.
   */
  it('declares the derived brand aliases on every brand scope, light and dark', () => {
    const light = block('[data-brand-scope],\n[style*="--brand-primary"]');
    expect(css).toContain(
      ':root,\n[data-brand-root],\n[data-brand-scope],\n[style*="--brand-primary"] {',
    );
    expect(light).toContain('--brand-accent: var(--brand-primary)');
    expect(light).toContain('--brand-on-accent: var(--brand-on-primary)');
    expect(light).toContain(
      '--brand-primary-hover: color-mix(in oklch, var(--brand-primary), black 12%)',
    );
    expect(light).toContain(
      '--brand-primary-soft: color-mix(in oklch, var(--brand-primary), white 88%)',
    );
    expect(light).toContain('--brand-gradient: linear-gradient(135deg');

    const dark = block('[data-theme="dark"] [data-brand-scope]');
    expect(css).toContain('[data-brand-scope][data-theme="dark"] {');
    expect(dark).toContain('--brand-accent: var(--brand-primary-dark)');
    expect(dark).toContain('--brand-on-accent: var(--brand-on-primary-dark)');
    expect(dark).toContain(
      '--brand-primary-soft: color-mix(in oklch, var(--brand-primary-dark), var(--theme-bg) 80%)',
    );

    // A light frame inside a dark page gets the light pair back (declared last: source order wins).
    const lightInDark = block('[data-brand-scope][data-theme="light"]');
    expect(lightInDark).toContain('--brand-accent: var(--brand-primary)');
    expect(css.indexOf('[data-brand-scope][data-theme="light"] {')).toBeGreaterThan(
      css.indexOf('[data-brand-scope][data-theme="dark"] {'),
    );
  });

  it('switches the ground to the dark neutrals under [data-theme="dark"]', () => {
    const dark = block('[data-theme="dark"]');
    expect(dark).toContain('--theme-bg: #0f1118');
    expect(dark).toContain('--theme-text: #f2f5fa');
  });

  it('ships the device/safe-area contract and the glass bar', () => {
    expect(css).toContain('--safe-top: max(env(safe-area-inset-top), 12px)');
    expect(css).toContain('--safe-bottom: max(env(safe-area-inset-bottom), 8px)');
    expect(css).toContain('--nav-height: 64px');
    expect(css).toContain('.app-scroll');
    expect(css).toContain('.glass-bar');
    expect(css).toContain('.pb-safe');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });

  it('does not carry the prototype legacy brand aliases', () => {
    for (const forbidden of [
      'gold',
      'emerald',
      'forest',
      'teal',
      'sage',
      'mist',
      'btn-gold',
      'brand-ig-mark',
      'pill-',
    ]) {
      expect(css, `${forbidden} absent`).not.toContain(forbidden);
    }
  });
});

/**
 * Phase 4 adds exactly ONE token (UI-D-08). `--color-like` is the affective like colour: same value
 * as `--color-danger` today, a different meaning — a like is not destructive, and a Phase 8
 * destructive-palette change must not move the heart. It is also deliberately not the tenant accent,
 * because a brand-coloured heart loses a universally-read affordance.
 */
describe('tokens.css — --color-like, the one Phase 4 token (UI-D-08)', () => {
  it('is declared in the light block and in the dark block, with the same value', () => {
    expect(block(':root,\n[data-theme="light"] {')).toContain('--color-like: #ef4444');
    expect(block('[data-theme="dark"] {')).toContain('--color-like: #ef4444');
  });

  it('is declared in the theme block so text-like, fill-like and bg-like compile', () => {
    expect(block('@theme inline')).toContain('--color-like: #ef4444');
  });

  it('is its own value — never an alias of the destructive token or of the tenant accent', () => {
    const declarations = css
      .split('\n')
      .filter((line) => !/^\s*(\/\*|\*)/.test(line))
      .join('\n');
    expect(declarations).not.toContain('--color-like: var(--color-danger)');
    expect(declarations).not.toContain('--color-like: var(--brand');
    // and the destructive token keeps its own separate declaration
    expect(block('@theme inline')).toContain('--color-danger: #ef4444');
  });

  it('adds no second Phase 4 token', () => {
    const introduced = [...css.matchAll(/--color-([a-z-]+):/g)].map((m) => m[1]);
    expect(introduced).toContain('like');
    for (const unexpected of ['like-soft', 'like-hover', 'heart']) {
      expect(introduced, `${unexpected} not introduced`).not.toContain(unexpected);
    }
  });
});
