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

  it('binds the button utilities to the --button-* trio, right after the brand aliases', () => {
    // 2026-10-03: bg-button, text-on-button and hover:bg-button-hover, the filled action button's
    // own colour.
    expect(block('@theme inline')).toContain(
      [
        '--color-brand-hover: var(--brand-primary-hover);',
        '  --color-button: var(--button-fill);',
        '  --color-on-button: var(--button-ink);',
        '  --color-button-hover: var(--button-hover);',
      ].join('\n'),
    );
  });

  it('binds border-brand-secondary to the runtime secondary (the unseen story ring, 2026-10-06)', () => {
    expect(block('@theme inline')).toContain('--color-brand-secondary: var(--brand-secondary);');
  });
});

describe('tokens.css — neutral fallback brand and the two theme layers', () => {
  it('carries the neutral platform brand fallback and the light neutrals on :root (and explicit light scopes)', () => {
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
    // The selector also appears in the Layer 1b note above the rules: read the RULE (` {`).
    const lightInDark = block('[data-brand-scope][data-theme="light"] {');
    expect(lightInDark).toContain('--brand-accent: var(--brand-primary)');
    expect(css.indexOf('[data-brand-scope][data-theme="light"] {')).toBeGreaterThan(
      css.indexOf('[data-brand-scope][data-theme="dark"] {'),
    );

    // 2026-10-03: the button trio rides the same rules, each theme reading its own raw key and
    // falling back to the value `bg-brand`, `text-on-brand` and `hover:bg-brand-hover` read.
    for (const scope of [light, lightInDark]) {
      expect(scope).toContain('--button-fill: var(--button-fill-light, var(--brand-accent))');
      expect(scope).toContain('--button-ink: var(--button-ink-light, var(--brand-on-accent))');
      expect(scope).toContain(
        '--button-hover: var(--button-hover-light, var(--brand-primary-hover))',
      );
    }
    expect(dark).toContain('--button-fill: var(--button-fill-dark, var(--brand-accent))');
    expect(dark).toContain('--button-ink: var(--button-ink-dark, var(--brand-on-accent))');
    // Today's dark hover is the LIGHT primary's shade (the dark flip never re-declares it): kept.
    expect(dark).toContain('--button-hover: var(--button-hover-dark, var(--brand-primary-hover))');

    // ...and so does the gradient button's image, `none` (nothing over the fill) without its key.
    for (const scope of [light, lightInDark]) {
      expect(scope).toContain('--button-image: var(--button-image-light, none)');
      expect(scope).toContain('--button-image-hover: var(--button-image-hover-light, none)');
    }
    expect(dark).toContain('--button-image: var(--button-image-dark, none)');
    expect(dark).toContain('--button-image-hover: var(--button-image-hover-dark, none)');
  });

  /**
   * The wizard's device screen is a brand scope only through `[style*="--brand-primary"]`, so a
   * light screen inside a dark panel also matches the dark descendant rule, at the same (0,2,0).
   * Its own tie-break, keyed on the screen's attributes and declared after the dark flip, hands
   * back the light accent pair, the light button trio and its image (the preview sets both themes'
   * raw keys inline).
   */
  it('a light device screen in a dark panel gets the light pair, button trio and image back', () => {
    const screen = block('[data-device-screen][data-theme="light"] {');
    expect(screen).toContain('--brand-accent: var(--brand-primary)');
    expect(screen).toContain('--brand-on-accent: var(--brand-on-primary)');
    expect(screen).toContain(
      '--brand-primary-soft: color-mix(in oklch, var(--brand-primary), white 88%)',
    );
    expect(screen).toContain('--button-fill: var(--button-fill-light, var(--brand-accent))');
    expect(screen).toContain('--button-ink: var(--button-ink-light, var(--brand-on-accent))');
    expect(screen).toContain(
      '--button-hover: var(--button-hover-light, var(--brand-primary-hover))',
    );
    expect(screen).toContain('--button-image: var(--button-image-light, none)');
    expect(screen).toContain('--button-image-hover: var(--button-image-hover-light, none)');
    expect(css.indexOf('[data-device-screen][data-theme="light"] {')).toBeGreaterThan(
      css.indexOf('[data-theme="dark"] [style*="--brand-primary"],'),
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
 * The shell's chrome over its scroll root (2026-10-02). Every overlay renders INSIDE
 * `main.app-scroll`, so the scroll root must never become a stacking context: on iOS
 * `-webkit-overflow-scrolling: touch` does exactly that and traps the story viewer, the sheets and
 * the dialogs under the z-50 TopBar and BottomNav. Chromium ignores the property, so no e2e can see
 * the trap; this file is its only automated guard. The chrome then steps aside by DECLARATION, in
 * unlayered rules the screens opt into, and the BottomNav also for the on-screen keyboard, which it
 * reads from the visual viewport and marks on itself (`data-keyboard-open`), never from `:focus`.
 */
describe('tokens.css — the shell chrome over the scroll root (iOS stacking, declared hiding)', () => {
  /** Comments out, whitespace collapsed, no padding inside parentheses: selectors compare as text. */
  const flat = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');

  /** The selector list and the body of the rule whose selector list starts with `head`. */
  function rule(head: string): { selector: string; body: string } {
    const at = flat.indexOf(head);
    expect(at, `rule ${head} present`).toBeGreaterThanOrEqual(0);
    const open = flat.indexOf('{', at);
    return {
      selector: flat.slice(at, open).trim(),
      body: flat.slice(open + 1, flat.indexOf('}', open)).trim(),
    };
  }

  it('the scroll root never declares -webkit-overflow-scrolling (the iOS stacking-context trap)', () => {
    expect(block('.app-scroll {')).not.toContain('-webkit-overflow-scrolling');
    expect(flat).not.toContain('-webkit-overflow-scrolling');
    // Still the one scroller, momentum and all (the iOS default since 13).
    expect(block('.app-scroll {')).toContain('overflow-y: auto');
  });

  it('a full-screen surface (data-shell-hide="chrome") hides the TopBar AND the BottomNav', () => {
    const chrome = rule('[data-brand-root]:has([data-shell-hide="chrome"])');
    expect(chrome.selector).toBe(
      '[data-brand-root]:has([data-shell-hide="chrome"]) :is([data-shell-topbar], [data-shell-nav="bottom"])',
    );
    expect(chrome.body).toBe('display: none;');
  });

  it('only the BottomNav steps aside on a task screen and under any modal', () => {
    const nav = rule('[data-brand-root]:has([data-shell-hide="nav"], [aria-modal="true"])');
    expect(nav.selector).toBe(
      '[data-brand-root]:has([data-shell-hide="nav"], [aria-modal="true"]) [data-shell-nav="bottom"]',
    );
    expect(nav.selector).not.toContain('data-shell-topbar');
    expect(nav.body).toBe('display: none;');
  });

  it('the BottomNav steps aside for the keyboard it marks itself, in a rule with no :has()', () => {
    const keyboard = rule('[data-shell-nav="bottom"][data-keyboard-open]');
    expect(keyboard.selector).toBe('[data-shell-nav="bottom"][data-keyboard-open]');
    expect(keyboard.body).toBe('display: none;');
    // The WHOLE selector list, not a suffix: the rule starts right after the previous one closes.
    expect(flat).toContain('} [data-shell-nav="bottom"][data-keyboard-open] { display: none; }');
  });

  it('no rule hides the chrome while a field merely has focus', () => {
    // Android's back gesture closes the keyboard and keeps the focus: a focus rule would leave the
    // bar hidden with no keyboard on screen. Every selector list that names a bar (the chrome rule,
    // the nav rule and the keyboard rule) is checked.
    const chrome = [...flat.matchAll(/([^{}]*)\{/g)]
      .map((match) => (match[1] ?? '').trim())
      .filter((selector) => /\[data-shell-(topbar|nav="bottom")\]/.test(selector));
    expect(chrome).toHaveLength(3);
    for (const selector of chrome) expect(selector).not.toContain(':focus');
  });

  it('a task screen drops the BottomNav reserve from the scroll root, on the phone only', () => {
    expect(flat).toContain(
      '@media (max-width: 767px) { [data-brand-root]:has([data-shell-hide="nav"]) .app-scroll { padding-bottom: calc(var(--safe-bottom) + 1rem); } }',
    );
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

/**
 * The tenant's ground tones (2026-10-02; the wizard previews them, nothing stores them yet). Layer
 * 1c re-tints the light theme's backgrounds under `data-bg-tone`, Layer 1d the dark theme's
 * surfaces under `data-dark-tone`, both from FIXED palettes keyed by the ids of
 * apps/web/lib/bg-tone.ts, so no hex ever leaves this file. The claims a later edit could quietly
 * break:
 *
 *  1. The layers are ADDITIVE: the first `:root` block and the dark block keep the current
 *     neutrals, which are also each palette's default row and the rebindings' fallbacks, and both
 *     layers sit between Layer 1b and the theme aliases (`block()` above reads the FIRST match).
 *  2. Every id has its row with the raw variables a swatch paints from, the default rows are the
 *     current families, and every tone keeps the theme's inks legible (text 7:1, secondary 4.5:1).
 *     A light row is a whole background family (2026-10-03): seven keys, its glass its own surface
 *     at 0.82, its layers in the family's order of lightness, and amarelado is the reference's
 *     (REINE's) light family value for value, so picking it gives exactly the reference's ground.
 *  3. A rebinding never applies where the NEAREST theme is the other one, and does apply where its
 *     own theme is declared. Judged over every nesting of light, dark and unthemed scopes four deep
 *     by a matcher for exactly the grammar the two rules use: happy-dom 20 drops a complex selector
 *     inside :not() (it reads `:not([data-theme="dark"] *)` as matching anything), so it cannot
 *     judge them, and anything outside that grammar throws instead of guessing. Without a tone
 *     attribute no rule of either layer applies at all (the app as it is, the platform panel, a
 *     dark scope).
 *  4. The light rebinding repaints the eight light backgrounds (the ground, both raised surfaces,
 *     the input and tertiary fills, the card hover, the glass bar and the handle), each falling
 *     back to today's value, and never an ink nor an ink-drawn tint; the dark one the eight opaque
 *     dark surfaces.
 */
describe('tokens.css — the tenant ground tones (Layer 1c light, Layer 1d dark)', () => {
  const LIGHT_IDS = [
    'cinza',
    'amarelado',
    'laranjado',
    'avermelhado',
    'lilas',
    'azulado',
    'agua',
    'esverdeado',
  ];
  const DARK_IDS = [
    'grafite',
    'cafe',
    'terracota',
    'vinho',
    'berinjela',
    'azul-noite',
    'petroleo',
    'musgo',
  ];
  const LIGHT_REBINDING =
    '[data-bg-tone]:not([data-theme="dark"], [data-theme="dark"] *), [data-bg-tone][data-theme="light"]';
  const DARK_REBINDING =
    '[data-dark-tone][data-theme="dark"], [data-theme="dark"] [data-dark-tone]:not([data-theme="light"], [data-theme="light"] *)';
  const HEX = /^#[0-9a-f]{6}$/;

  /**
   * Comments out and whitespace collapsed: every innermost rule as `{ selector, body }` (a
   * statement at-rule before it, like the dark variant's, ends at its `;`).
   */
  const flat = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');
  const rules = [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => {
    const head = match[1] ?? '';
    return {
      selector: head.slice(head.lastIndexOf(';') + 1).trim(),
      body: (match[2] ?? '').trim(),
    };
  });

  /** The declarations of the ONE rule whose whole selector list is `selector`. */
  function declared(selector: string): Record<string, string> {
    const found = rules.filter((rule) => rule.selector === selector);
    expect(found, `exactly one rule ${selector}`).toHaveLength(1);
    return Object.fromEntries(
      (found[0]?.body ?? '')
        .split(';')
        .map((declaration) => declaration.trim())
        .filter(Boolean)
        .map((declaration) => {
          const colon = declaration.indexOf(':');
          return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
        }),
    );
  }

  const lightBlock = declared(':root, [data-theme="light"]');
  const darkBlock = declared('[data-theme="dark"]');

  /** WCAG 2.x, as `contrastRatio` in the contracts package computes it. */
  function luminance(hex: string): number {
    const channel = (at: number) => {
      const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  }
  function contrast(a: string, b: string): number {
    const [la, lb] = [luminance(a), luminance(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  it('is additive: the current neutrals stay put, both layers between Layer 1b and the aliases', () => {
    expect(block(':root')).toContain('--theme-bg: #f5f7fb');
    expect(lightBlock).toMatchObject({
      '--theme-bg': '#f5f7fb',
      '--theme-bg-input': '#eef2f9',
      '--theme-bg-tertiary': '#e9eef7',
      '--theme-card-hover': '#f8fafd',
      '--theme-handle': '#c3cede',
      '--theme-card': '#ffffff',
      '--theme-bg-secondary': '#ffffff',
      '--theme-glass-bar': 'rgba(255, 255, 255, 0.82)',
    });
    expect(darkBlock).toMatchObject({
      '--theme-bg': '#0f1118',
      '--theme-bg-secondary': '#181c26',
      '--theme-card': '#181c26',
      '--theme-bg-tertiary': '#232937',
      '--theme-bg-input': '#232937',
      '--theme-card-hover': '#232937',
      '--theme-glass-bar': 'rgba(24, 28, 38, 0.82)',
      '--theme-handle': '#3c4658',
    });

    const layer1b = css.indexOf('[data-brand-scope][data-theme="light"] {');
    const aliases = css.indexOf('@theme inline');
    const toneText = /data-(bg|dark)-tone|--d?tone-/;
    expect(css.slice(0, layer1b)).not.toMatch(toneText);
    expect(css.slice(aliases)).not.toMatch(toneText);
    for (const head of [
      '[data-bg-tone="cinza"] {',
      '[data-bg-tone]:not([data-theme="dark"], [data-theme="dark"] *),\n',
      '[data-dark-tone="grafite"] {',
      '[data-dark-tone][data-theme="dark"],\n',
    ]) {
      const at = css.indexOf(head);
      expect(at, `${head} placed after Layer 1b`).toBeGreaterThan(layer1b);
      expect(at, `${head} placed before the aliases`).toBeLessThan(aliases);
    }
  });

  it('carries the eight light families; cinza is the current gray, amarelado the reference', () => {
    const ids = [...new Set([...flat.matchAll(/\[data-bg-tone="([^"]+)"\]/g)].map((m) => m[1]))];
    expect(ids).toEqual(LIGHT_IDS);
    const grounds = new Set<string>();
    for (const id of LIGHT_IDS) {
      const row = declared(`[data-bg-tone="${id}"]`);
      expect(Object.keys(row).sort(), id).toEqual([
        '--tone-card-hover',
        '--tone-glass',
        '--tone-ground',
        '--tone-handle',
        '--tone-input',
        '--tone-surface',
        '--tone-tertiary',
      ]);
      const layers = [
        '--tone-surface',
        '--tone-card-hover',
        '--tone-ground',
        '--tone-input',
        '--tone-tertiary',
        '--tone-handle',
      ];
      for (const key of layers) expect(row[key], `${id} ${key}`).toMatch(HEX);
      grounds.add(row['--tone-ground'] ?? '');
      // The glass bar is the surface at the light block's alpha: it reads as the same surface.
      const surface = row['--tone-surface'] ?? '';
      const channels = [1, 3, 5].map((at) => Number.parseInt(surface.slice(at, at + 2), 16));
      expect(row['--tone-glass'], id).toBe(`rgba(${channels.join(', ')}, 0.82)`);
      // The family's order, lightest first, as in the reference and the gray: the raised surface,
      // the card hover, the ground, the input, the tertiary fill and the handle.
      const lightness = layers.map((key) => luminance(row[key] ?? ''));
      expect(lightness, id).toEqual([...lightness].sort((a, b) => b - a));
      expect(new Set(lightness).size, id).toBe(layers.length);
      // The light inks stay legible on every layer the rebinding repaints under text.
      for (const fill of ['--tone-ground', '--tone-surface', '--tone-input', '--tone-tertiary']) {
        const under = row[fill] ?? '';
        expect(contrast(lightBlock['--theme-text'] ?? '', under), `${id} ${fill}`).toBeGreaterThan(
          7,
        );
        expect(
          contrast(lightBlock['--theme-text-secondary'] ?? '', under),
          `${id} ${fill}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(grounds.size).toBe(LIGHT_IDS.length);
    // Cinza is today's gray family, white surfaces and all (only its swatch ever reads it).
    expect(declared('[data-bg-tone="cinza"]')).toEqual({
      '--tone-ground': lightBlock['--theme-bg'],
      '--tone-surface': lightBlock['--theme-bg-secondary'],
      '--tone-input': lightBlock['--theme-bg-input'],
      '--tone-tertiary': lightBlock['--theme-bg-tertiary'],
      '--tone-card-hover': lightBlock['--theme-card-hover'],
      '--tone-glass': lightBlock['--theme-glass-bar'],
      '--tone-handle': lightBlock['--theme-handle'],
    });
    expect(lightBlock['--theme-card']).toBe(lightBlock['--theme-bg-secondary']);
    // Amarelado IS the reference's light family (REINE: its --theme-bg; --theme-bg-secondary and
    // --theme-card; --theme-bg-input; --theme-bg-tertiary; --theme-card-hover; --theme-glass-bar;
    // --theme-handle), value for value: the owner asked for exactly the reference's background.
    expect(declared('[data-bg-tone="amarelado"]')).toEqual({
      '--tone-ground': '#f5efe5',
      '--tone-surface': '#fffcf6',
      '--tone-input': '#efe7da',
      '--tone-tertiary': '#ede4d6',
      '--tone-card-hover': '#f9f3e9',
      '--tone-glass': 'rgba(255, 252, 246, 0.82)',
      '--tone-handle': '#d8ccbb',
    });
  });

  it('pins the six families derived from the reference, value for value', () => {
    // Each is the reference's family re-drawn at its own ground's hue (the recipe in the Layer 1c
    // comment); pinned here so a row drifting back to white surfaces, or a shade off by a step,
    // fails a test instead of only the derivation script (review of 2026-10-03).
    const family = (
      surface: string,
      input: string,
      tertiary: string,
      cardHover: string,
      handle: string,
    ) => {
      const channels = [1, 3, 5].map((at) => Number.parseInt(surface.slice(at, at + 2), 16));
      return {
        '--tone-surface': surface,
        '--tone-input': input,
        '--tone-tertiary': tertiary,
        '--tone-card-hover': cardHover,
        '--tone-glass': `rgba(${channels.join(', ')}, 0.82)`,
        '--tone-handle': handle,
      };
    };
    const expected: Record<string, Record<string, string>> = {
      laranjado: {
        '--tone-ground': '#feece2',
        ...family('#fffcfa', '#fae3d6', '#f9e0d2', '#fff1e9', '#e6c7b5'),
      },
      avermelhado: {
        '--tone-ground': '#fcebec',
        ...family('#fffbfb', '#f8e2e3', '#f6dee0', '#ffeff0', '#e3c5c7'),
      },
      lilas: {
        '--tone-ground': '#f2edf9',
        ...family('#fdfbff', '#ebe5f4', '#e9e1f2', '#f6f1fd', '#d2c9de'),
      },
      azulado: {
        '--tone-ground': '#e7f1fc',
        ...family('#fafcff', '#ddeaf8', '#d9e7f7', '#ecf5ff', '#bed0e3'),
      },
      agua: {
        '--tone-ground': '#e3f4f3',
        ...family('#f5fffe', '#d7eeec', '#d3ebea', '#e7f8f7', '#b7d5d3'),
      },
      esverdeado: {
        '--tone-ground': '#eaf3e8',
        ...family('#f9fef8', '#e0ecde', '#ddeada', '#eef7ec', '#c4d3c0'),
      },
    };
    for (const [id, row] of Object.entries(expected)) {
      expect(declared(`[data-bg-tone="${id}"]`), id).toEqual(row);
    }
  });

  it('carries the eight dark tones; grafite is the current family, each bar its own secondary', () => {
    const ids = [...new Set([...flat.matchAll(/\[data-dark-tone="([^"]+)"\]/g)].map((m) => m[1]))];
    expect(ids).toEqual(DARK_IDS);
    const grounds = new Set<string>();
    for (const id of DARK_IDS) {
      const row = declared(`[data-dark-tone="${id}"]`);
      // Grafite is today's family as it was; the REINE-toned ones add their tertiary ink.
      expect(Object.keys(row).sort(), id).toEqual([
        '--dtone-glass',
        '--dtone-ground',
        '--dtone-handle',
        ...(id === 'grafite' ? [] : ['--dtone-ink-tertiary']),
        '--dtone-secondary',
        '--dtone-tertiary',
      ]);
      for (const key of [
        '--dtone-ground',
        '--dtone-secondary',
        '--dtone-tertiary',
        '--dtone-handle',
      ]) {
        expect(row[key], `${id} ${key}`).toMatch(HEX);
      }
      grounds.add(row['--dtone-ground'] ?? '');
      // The glass bar is the secondary at the dark block's alpha: it reads as the same surface.
      const secondary = row['--dtone-secondary'] ?? '';
      const channels = [1, 3, 5].map((at) => Number.parseInt(secondary.slice(at, at + 2), 16));
      expect(row['--dtone-glass'], id).toBe(`rgba(${channels.join(', ')}, 0.82)`);
      for (const fill of ['--dtone-ground', '--dtone-secondary', '--dtone-tertiary']) {
        const surface = row[fill] ?? '';
        expect(contrast(darkBlock['--theme-text'] ?? '', surface), `${id} ${fill}`).toBeGreaterThan(
          7,
        );
        expect(
          contrast(darkBlock['--theme-text-secondary'] ?? '', surface),
          `${id} ${fill}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(grounds.size).toBe(DARK_IDS.length);
    expect(declared('[data-dark-tone="grafite"]')).toEqual({
      '--dtone-ground': darkBlock['--theme-bg'],
      '--dtone-secondary': darkBlock['--theme-bg-secondary'],
      '--dtone-tertiary': darkBlock['--theme-bg-tertiary'],
      '--dtone-glass': darkBlock['--theme-glass-bar'],
      '--dtone-handle': darkBlock['--theme-handle'],
    });
  });

  it('the light rebinding repaints the eight light backgrounds, falling back to today’s', () => {
    // The whole object: exactly these eight, so no ink (--theme-text*) and no ink-drawn tint
    // (hover, active, border, border-secondary, divider, chip, rims, bar shadow) is ever rebound.
    expect(declared(LIGHT_REBINDING)).toEqual({
      '--theme-bg': `var(--tone-ground, ${lightBlock['--theme-bg']})`,
      '--theme-bg-secondary': `var(--tone-surface, ${lightBlock['--theme-bg-secondary']})`,
      '--theme-card': `var(--tone-surface, ${lightBlock['--theme-card']})`,
      '--theme-bg-input': `var(--tone-input, ${lightBlock['--theme-bg-input']})`,
      '--theme-bg-tertiary': `var(--tone-tertiary, ${lightBlock['--theme-bg-tertiary']})`,
      '--theme-card-hover': `var(--tone-card-hover, ${lightBlock['--theme-card-hover']})`,
      '--theme-glass-bar': `var(--tone-glass, ${lightBlock['--theme-glass-bar']})`,
      '--theme-handle': `var(--tone-handle, ${lightBlock['--theme-handle']})`,
    });
    // ...and today's fallbacks are the white surfaces and the white glass, literally.
    expect(lightBlock).toMatchObject({
      '--theme-bg-secondary': '#ffffff',
      '--theme-card': '#ffffff',
      '--theme-glass-bar': 'rgba(255, 255, 255, 0.82)',
    });
  });

  it('the dark rebinding repaints the eight opaque dark surfaces, falling back to the grafite', () => {
    expect(declared(DARK_REBINDING)).toEqual({
      '--theme-bg': `var(--dtone-ground, ${darkBlock['--theme-bg']})`,
      '--theme-bg-secondary': `var(--dtone-secondary, ${darkBlock['--theme-bg-secondary']})`,
      '--theme-card': `var(--dtone-secondary, ${darkBlock['--theme-card']})`,
      '--theme-bg-tertiary': `var(--dtone-tertiary, ${darkBlock['--theme-bg-tertiary']})`,
      '--theme-bg-input': `var(--dtone-tertiary, ${darkBlock['--theme-bg-input']})`,
      '--theme-card-hover': `var(--dtone-tertiary, ${darkBlock['--theme-card-hover']})`,
      '--theme-glass-bar': `var(--dtone-glass, ${darkBlock['--theme-glass-bar']})`,
      '--theme-handle': `var(--dtone-handle, ${darkBlock['--theme-handle']})`,
      // The REINE-toned families' own tertiary ink (2026-10-05); grafite keeps the dark block's.
      '--theme-text-tertiary': `var(--dtone-ink-tertiary, ${darkBlock['--theme-text-tertiary']})`,
    });
  });

  it('2026-10-05: Marrom (cafe) is the REINE dark family exactly, the other tones its lightness and chroma', () => {
    const family = (ground: string, secondary: string, tertiary: string, handle: string) => {
      const channels = [1, 3, 5].map((at) => Number.parseInt(secondary.slice(at, at + 2), 16));
      return {
        '--dtone-ground': ground,
        '--dtone-secondary': secondary,
        '--dtone-tertiary': tertiary,
        '--dtone-glass': `rgba(${channels.join(', ')}, 0.82)`,
        '--dtone-handle': handle,
        '--dtone-ink-tertiary': '#7987a0',
      };
    };
    const expected: Record<string, Record<string, string>> = {
      // socialroberth-completo's [data-theme="dark"]: bg, bg-secondary/card, bg-tertiary/input/card
      // hover, handle and glass bar, value for value.
      cafe: family('#382317', '#432c1e', '#4f3627', '#6b4d38'),
      terracota: family('#39221a', '#442b21', '#50352a', '#6e4b3e'),
      vinho: family('#392126', '#44292f', '#50333a', '#6d4851'),
      berinjela: family('#322233', '#3d2b3e', '#48354a', '#634b65'),
      'azul-noite': family('#1b2a3b', '#233347', '#2c3e53', '#405671'),
      petroleo: family('#0f2d35', '#163740', '#1f424b', '#305c67'),
      musgo: family('#232c18', '#2c361f', '#364128', '#4c5a3b'),
    };
    expect(expected.cafe?.['--dtone-glass']).toBe('rgba(67, 44, 30, 0.82)');
    for (const [id, row] of Object.entries(expected)) {
      expect(declared(`[data-dark-tone="${id}"]`), id).toEqual(row);
      // Their own tertiary ink keeps the grafite's relation, at worst as legible as there (2.96).
      for (const fill of ['--dtone-ground', '--dtone-secondary', '--dtone-tertiary']) {
        expect(contrast('#7987a0', row[fill] ?? ''), `${id} ${fill}`).toBeGreaterThanOrEqual(2.96);
      }
    }
  });

  /** One element on a chain of scopes: its attributes and its parent (the document's is null). */
  type Scope = { attrs: Record<string, string>; parent: Scope | null };

  /** Splits at `separator` outside brackets and parentheses. */
  function splitTop(text: string, separator: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let at = 0; at < text.length; at++) {
      const char = text[at];
      if (char === '(' || char === '[') depth++;
      else if (char === ')' || char === ']') depth--;
      else if (char === separator && depth === 0) {
        parts.push(text.slice(start, at));
        start = at + 1;
      }
    }
    parts.push(text.slice(start));
    return parts.map((part) => part.trim()).filter(Boolean);
  }

  function matchesList(list: string, node: Scope): boolean {
    return splitTop(list, ',').some((complex) => matchesComplex(complex, node));
  }

  /** Descendant combinators only: the nearest matching ancestor per compound, right to left. */
  function matchesComplex(complex: string, node: Scope): boolean {
    const compounds = splitTop(complex, ' ');
    const subject = compounds.pop();
    if (subject === undefined || !matchesCompound(subject, node)) return false;
    let ancestor = node.parent;
    for (const compound of compounds.reverse()) {
      while (ancestor && !matchesCompound(compound, ancestor)) ancestor = ancestor.parent;
      if (!ancestor) return false;
      ancestor = ancestor.parent;
    }
    return true;
  }

  function matchesCompound(compound: string, node: Scope): boolean {
    let rest = compound;
    while (rest) {
      if (rest.startsWith('*')) {
        rest = rest.slice(1);
        continue;
      }
      const attribute = /^\[([\w-]+)(?:="([^"]*)")?\]/.exec(rest);
      if (attribute) {
        const [whole, name = '', value] = attribute;
        if (!Object.hasOwn(node.attrs, name)) return false;
        if (value !== undefined && node.attrs[name] !== value) return false;
        rest = rest.slice(whole.length);
        continue;
      }
      if (rest.startsWith(':not(')) {
        let depth = 0;
        let close = -1;
        for (let at = 4; at < rest.length && close < 0; at++) {
          if (rest[at] === '(') depth++;
          else if (rest[at] === ')' && --depth === 0) close = at;
        }
        if (close < 0) throw new Error(`unbalanced :not() in ${rest}`);
        if (matchesList(rest.slice(5, close), node)) return false;
        rest = rest.slice(close + 1);
        continue;
      }
      throw new Error(`selector part outside the test grammar: ${rest}`);
    }
    return true;
  }

  type Theme = 'light' | 'dark' | null;
  const THEMES: readonly Theme[] = [null, 'light', 'dark'];
  /** Every chain document > wrapper > wrapper > toned element, each light, dark or unthemed. */
  const chains = THEMES.flatMap((a) =>
    THEMES.flatMap((b) => THEMES.flatMap((c) => THEMES.map((own) => [a, b, c, own]))),
  );
  const toned = (chain: readonly Theme[]): Scope =>
    chain.reduce<Scope | null>(
      (parent, theme, index) => ({
        attrs: {
          ...(theme ? { 'data-theme': theme } : {}),
          ...(index === chain.length - 1
            ? { 'data-bg-tone': 'amarelado', 'data-dark-tone': 'cafe' }
            : {}),
        },
        parent,
      }),
      null,
    ) as Scope;
  /** What the cascade gives the element: its own theme, else the nearest ancestor's, else light. */
  function nearestTheme(node: Scope): 'light' | 'dark' {
    for (let scope: Scope | null = node; scope; scope = scope.parent) {
      const theme = scope.attrs['data-theme'];
      if (theme === 'light' || theme === 'dark') return theme;
    }
    return 'light';
  }

  it('each rebinding applies only where its theme is the nearest one, and wherever it is declared', () => {
    expect(chains).toHaveLength(81);
    const hits = { light: 0, dark: 0 };
    for (const chain of chains) {
      const element = toned(chain);
      const where = chain.map((theme) => theme ?? '-').join(' > ');
      const nearest = nearestTheme(element);
      const light = matchesList(LIGHT_REBINDING, element);
      const dark = matchesList(DARK_REBINDING, element);
      if (light) expect(nearest, `light tone on ${where}`).toBe('light');
      if (dark) expect(nearest, `dark tone on ${where}`).toBe('dark');

      const own = chain.at(-1) ?? null;
      const above = chain.slice(0, -1).filter((theme) => theme !== null);
      // The wizard's device screen and the BrandPreview frames always declare their own theme.
      if (own === 'light') expect(light, `light tone on ${where}`).toBe(true);
      if (own === 'dark') expect(dark, `dark tone on ${where}`).toBe(true);
      // An app root declares none: the document's (or a wrapper's) theme decides.
      if (own === null && !above.includes('dark')) expect(light, `light on ${where}`).toBe(true);
      if (own === null && above.includes('dark') && !above.includes('light')) {
        expect(dark, `dark on ${where}`).toBe(true);
      }
      hits.light += Number(light);
      hits.dark += Number(dark);
    }
    expect(hits.light).toBeGreaterThan(0);
    expect(hits.dark).toBeGreaterThan(0);
  });

  it('without a tone attribute no rule of either layer applies: the app, the panel, a dark scope', () => {
    // Every rule that declares or reads a raw tone key: the sixteen rows and the two rebindings.
    const toneRules = rules.filter((rule) => /--d?tone-/.test(rule.body));
    expect(toneRules).toHaveLength(LIGHT_IDS.length + DARK_IDS.length + 2);
    const untoned = (chain: readonly Theme[]): Scope =>
      chain.reduce<Scope | null>(
        (parent, theme) => ({ attrs: { ...(theme ? { 'data-theme': theme } : {}) }, parent }),
        null,
      ) as Scope;
    for (const chain of chains) {
      const element = untoned(chain);
      const where = chain.map((theme) => theme ?? '-').join(' > ');
      for (const rule of toneRules) {
        expect(matchesList(rule.selector, element), `${rule.selector} on ${where}`).toBe(false);
      }
    }
    // ...while the same element with the attribute does take its row (the matcher is not blind).
    expect(
      matchesList('[data-bg-tone="amarelado"]', toned([null, null, null, null])),
      'a toned element takes its row',
    ).toBe(true);
  });
});

/**
 * The filled action button's own colour (2026-10-03), apart from the primary that chips, switches,
 * tabs and links keep. `bg-button`, `text-on-button` and `hover:bg-button-hover` read the
 * `--button-fill|ink|hover` trio; each member reads a per-theme RAW key (`--button-fill-light`,
 * ...) that only an inline style sets (the wizard's preview) and falls back to the brand value. The
 * claims a later edit could quietly break:
 *
 *  1. The trio is declared in exactly the rules that declare `--brand-accent`. One rule fewer and
 *     that scope inherits the trio its parent resolved (a dark frame showing the light button, a
 *     light screen in a dark panel the dark one) while every fill still looks right without a raw
 *     key, so no rendered check would notice.
 *  2. No raw key is ever DECLARED here: a var() substitutes where the property is declared, so a
 *     default (even on :root alone) would pin every tenant's button to the neutral brand.
 *  3. The gradient button's image (`--button-image`, `--button-image-hover`, read by
 *     `bg-(image:--button-image)` and `hover:bg-(image:--button-image-hover)`) rides the same rules
 *     and reads the raw key of the SAME theme as the accent beside it, with `none` as its only
 *     fallback: CSS has no default image, so without the key nothing covers the fill. A rule
 *     reading the other theme's key would show the light gradient in a dark frame, and any other
 *     fallback (the brand gradient, say) would turn every tenant's buttons into gradients.
 */
describe('tokens.css — the button colour, apart from the primary (2026-10-03)', () => {
  /** Comments out, whitespace collapsed: each innermost rule's selector list and declarations. */
  const rules = [
    ...css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .matchAll(/([^{}]+)\{([^{}]*)\}/g),
  ].map((match) => {
    const head = match[1] ?? '';
    const declarations: Record<string, string> = Object.fromEntries(
      (match[2] ?? '')
        .split(';')
        .map((declaration) => declaration.trim())
        .filter(Boolean)
        .map((declaration) => {
          const colon = declaration.indexOf(':');
          return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
        }),
    );
    return { selector: head.slice(head.lastIndexOf(';') + 1).trim(), declarations };
  });
  /** The selector lists of the rules declaring `property`, in source order. */
  const declaring = (property: string) =>
    rules.filter((rule) => Object.hasOwn(rule.declarations, property)).map((rule) => rule.selector);

  it('declares the trio and the image in exactly the --brand-accent rules, tie-breaks last', () => {
    const accent = declaring('--brand-accent');
    expect(accent).toEqual([
      ':root, [data-brand-root], [data-brand-scope], [style*="--brand-primary"]',
      [
        '[data-theme="dark"]',
        '[data-theme="dark"] [data-brand-root]',
        '[data-theme="dark"] [data-brand-scope]',
        '[data-theme="dark"] [style*="--brand-primary"]',
        '[data-brand-scope][data-theme="dark"]',
      ].join(', '),
      '[data-brand-scope][data-theme="light"]',
      '[data-device-screen][data-theme="light"]',
    ]);
    for (const property of [
      '--button-fill',
      '--button-ink',
      '--button-hover',
      '--button-image',
      '--button-image-hover',
    ]) {
      expect(declaring(property), property).toEqual(accent);
    }
  });

  it('never declares a raw key: only an inline style sets one', () => {
    for (const theme of ['light', 'dark']) {
      for (const part of ['fill', 'ink', 'hover']) {
        const raw = `--button-${part}-${theme}`;
        expect(declaring(raw), raw).toEqual([]);
        // ...yet the trio reads it, with a brand value as the fallback.
        expect(css, raw).toContain(`var(${raw}, var(--brand-`);
      }
      for (const part of ['image', 'image-hover']) {
        const raw = `--button-${part}-${theme}`;
        expect(declaring(raw), raw).toEqual([]);
        // ...yet the image reads it, with no image as the fallback.
        expect(css, raw).toContain(`var(${raw}, none)`);
      }
    }
  });

  it('reads the image keys of the theme of the accent beside them, with none as the only fallback', () => {
    // The theme of a rule is the accent it declares: the dark flip's is the dark primary, every
    // other rule's (the base and the two light tie-breaks) the light one.
    const themed = rules.filter((rule) => Object.hasOwn(rule.declarations, '--brand-accent'));
    expect(themed).toHaveLength(4);
    const themes = themed.map((rule) =>
      rule.declarations['--brand-accent'] === 'var(--brand-primary-dark)' ? 'dark' : 'light',
    );
    expect(themes).toEqual(['light', 'dark', 'light', 'light']);
    themed.forEach((rule, at) => {
      const theme = themes[at];
      expect(rule.declarations['--button-image'], rule.selector).toBe(
        `var(--button-image-${theme}, none)`,
      );
      expect(rule.declarations['--button-image-hover'], rule.selector).toBe(
        `var(--button-image-hover-${theme}, none)`,
      );
      // The fill under the image reads the same theme: a scope never mixes the two.
      expect(rule.declarations['--button-fill'], rule.selector).toBe(
        `var(--button-fill-${theme}, var(--brand-accent))`,
      );
    });
  });
});
