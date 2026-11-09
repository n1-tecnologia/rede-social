import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The member skin's stylesheet and palette (2026-10-26) as a contract. member-skin.css is the look
 * of the members area and the store's shop window; tokens.css Layer 1f holds its colours. What a
 * later edit could quietly break, and no rendered check would notice at once:
 *
 *  1. The scope: every selector starts from a `:where()` holding `[data-member-skin]`, so the hook
 *     classes the admin screens share stay inert there.
 *  2. The white label: no colour literal in the stylesheet; every colour is a Layer 1f key mixed from
 *     the tenant's and the theme's keys, and every key read is declared.
 *  3. The overlays: sheets and dialogs render inside the page, so the scope, a panel and a static
 *     card never get a transform, a filter, an isolation, a z-index or a will-change, and the
 *     backdrop is fixed with no z-index.
 *  4. The motion: movement only under `prefers-reduced-motion: no-preference`, lifts only for a
 *     fine pointer, and the progress fill's own animation untouched (the e2e reads `progress-fill`).
 */
const here = dirname(fileURLToPath(import.meta.url));
const skinSource = readFileSync(resolve(here, '../src/styles/member-skin.css'), 'utf8');
const tokensSource = readFileSync(resolve(here, '../src/styles/tokens.css'), 'utf8');

const uncomment = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

type Rule = { selector: string; context: string[]; declarations: [string, string][] };

/** Splits on `separator` outside parentheses and quotes. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const char of text) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** The style rules (keyframes left out), each with the at-rule preludes around it. */
function parse(css: string): Rule[] {
  const rules: Rule[] = [];
  const stack: string[] = [];
  let buffer = '';
  let quote: string | null = null;
  for (const char of uncomment(css)) {
    if (quote) {
      buffer += char;
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
      buffer += char;
    } else if (char === '{') {
      stack.push(buffer.trim().replace(/\s+/g, ' '));
      buffer = '';
    } else if (char === '}') {
      const prelude = stack.pop() ?? '';
      if (!prelude.startsWith('@') && !stack.some((open) => open.startsWith('@keyframes'))) {
        const declarations = splitTopLevel(buffer, ';').map((declaration): [string, string] => {
          const colon = declaration.indexOf(':');
          return [
            declaration.slice(0, colon).trim(),
            declaration
              .slice(colon + 1)
              .trim()
              .replace(/\s+/g, ' '),
          ];
        });
        rules.push({ selector: prelude, context: [...stack], declarations });
      }
      buffer = '';
    } else {
      buffer += char;
    }
  }
  return rules;
}

/** The last compound of a selector (the element the rule styles), split outside parentheses. */
function subject(selector: string): string {
  return splitTopLevel(selector, ' ').at(-1) ?? '';
}

/** A compound without its `:not(...)` groups: `.ms-card:not(.ms-static):hover` styles a card. */
function positive(compound: string): string {
  return compound.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '');
}

const skin = uncomment(skinSource);
const rules = parse(skinSource);
const selectors = rules.flatMap((rule) => splitTopLevel(rule.selector, ','));

const layerStart = tokensSource.indexOf('/* ===== Layer 1f');
const layerEnd = tokensSource.indexOf('/* ===== Layer 2');
const layer = tokensSource.slice(layerStart, layerEnd);
const palette = parse(layer);

describe('member-skin.css — the scope', () => {
  it('has rules, and starts every selector from a :where() holding [data-member-skin]', () => {
    expect(selectors.length).toBeGreaterThan(50);
    for (const selector of selectors) {
      expect(selector, selector).toMatch(/^:where\([^()]*\[data-member-skin\][^()]*\)/);
    }
  });

  it('never uses !important, and none of the legacy brand words', () => {
    expect(skinSource).not.toContain('!important');
    for (const word of ['gold', 'emerald', 'forest', 'teal', 'sage', 'mist', 'pill-']) {
      expect(skinSource, word).not.toContain(word);
    }
  });
});

describe('member-skin.css — the white label', () => {
  it('carries no colour literal: no hex, no colour function', () => {
    expect(skin).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(skin).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i);
    expect(skin).not.toMatch(/\bwhite\b/);
    // `black` only as a mask's opaque stop, never a colour anyone sees.
    for (const line of skin.split('\n').filter((text) => /\bblack\b/.test(text))) {
      expect(line).toMatch(/mask-image/);
    }
  });

  it('mixes every colour from a key (or the text colour)', () => {
    const mixes = skin.match(/color-mix\([^;]*/g) ?? [];
    expect(mixes.length).toBeGreaterThan(0);
    for (const mix of mixes) expect(mix).toMatch(/var\(--|currentColor/);
  });

  it('reads only keys it or Layer 1f declares', () => {
    const declared = new Set(
      [...palette, ...rules.filter((rule) => rule.selector === ':where([data-member-skin])')]
        .flatMap((rule) => rule.declarations)
        .map(([property]) => property),
    );
    const read = [...skin.matchAll(/var\((--ms-[\w-]+)/g)].map((match) => match[1] ?? '');
    expect(read.length).toBeGreaterThan(40);
    for (const key of read) expect(declared.has(key), key).toBe(true);
  });
});

describe('member-skin.css — the overlays render inside the page', () => {
  const MOVING = [
    'transform',
    'translate',
    'scale',
    'rotate',
    'filter',
    'backdrop-filter',
    '-webkit-backdrop-filter',
    'will-change',
    'perspective',
    'contain',
  ];

  it('never gives the scope, a panel or a static card a transform, a filter, an isolation or a z-index', () => {
    let checked = 0;
    for (const rule of rules) {
      for (const selector of splitTopLevel(rule.selector, ',')) {
        const element = positive(subject(selector));
        if (element.includes('::')) continue;
        const holdsOverlays =
          selector === ':where([data-member-skin])' ||
          element.includes('.ms-static') ||
          (element.includes('.ms-panel') && !element.includes('.ms-card'));
        if (!holdsOverlays) continue;
        checked += 1;
        for (const [property, value] of rule.declarations) {
          expect(MOVING, `${selector} { ${property} }`).not.toContain(property);
          if (property === 'isolation' || property === 'z-index') {
            expect(value, `${selector} { ${property} }`).toBe('auto');
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(3);
  });

  // 2026-10-26: the whole screen, under the desktop rail too ("continua com bg branco"): the rail has
  // no ground of its own and sits on the chrome rung above this layer.
  it('draws the backdrop fixed over the whole screen, with no z-index and no offset for the rail', () => {
    const backdrop = rules.filter((rule) => subject(rule.selector) === '.ms-backdrop');
    expect(backdrop.length).toBe(1);
    expect(backdrop[0]?.declarations).toContainEqual(['position', 'fixed']);
    expect(backdrop[0]?.declarations).toContainEqual(['inset', '0']);
    const properties = backdrop[0]?.declarations.map(([property]) => property) ?? [];
    expect(properties).not.toContain('z-index');
    expect(properties).not.toContain('left');
  });
});

describe('member-skin.css — the motion', () => {
  it('moves only under no-preference, lifts only for a fine pointer, transforms only in keyframes', () => {
    for (const rule of rules) {
      const context = rule.context.join(' ');
      for (const [property, value] of rule.declarations) {
        const where = `${rule.selector} { ${property}: ${value} }`;
        expect(property, where).not.toBe('transform');
        if (['animation', 'will-change', 'translate', 'scale'].includes(property)) {
          expect(context, where).toContain('prefers-reduced-motion: no-preference');
        }
        if (property === 'translate' || property === 'scale') {
          expect(context, where).toContain('pointer: fine');
        }
      }
    }
  });

  it('stops every transition under reduced motion', () => {
    const reduced = rules.filter((rule) =>
      rule.context.includes('@media (prefers-reduced-motion: reduce)'),
    );
    expect(reduced.length).toBeGreaterThan(1);
    for (const rule of reduced) expect(rule.declarations).toEqual([['transition', 'none']]);
  });

  it('never animates the progress fill itself: its animation stays progress-fill', () => {
    for (const rule of rules) {
      for (const selector of splitTopLevel(rule.selector, ',')) {
        if (!/\.ms-bar$/.test(subject(selector))) continue;
        expect(
          rule.declarations.map(([property]) => property),
          selector,
        ).not.toContain('animation');
      }
    }
    expect(skin).toMatch(/\.ms-bar::after \{\s*animation: ms-bar-sheen/);
  });
});

describe('tokens.css — Layer 1f, the member skin palette', () => {
  it('sits after Layer 1e and before the utilities', () => {
    expect(layerStart).toBeGreaterThan(tokensSource.indexOf('/* ===== Layer 1e'));
    expect(layerEnd).toBeGreaterThan(layerStart);
    expect(tokensSource.indexOf('@theme inline')).toBeGreaterThan(layerEnd);
  });

  it('is two rules, the light look and the dark one, and the attribute appears nowhere else', () => {
    expect(palette.map((rule) => rule.selector)).toEqual([
      '[data-member-skin]',
      '[data-theme="dark"] [data-member-skin]',
    ]);
    expect(uncomment(tokensSource).split('[data-member-skin]')).toHaveLength(3);
  });

  it('declares --ms-* keys only, the dark rule overriding keys the light one declares', () => {
    const [light, dark] = palette.map((rule) => rule.declarations.map(([property]) => property));
    expect(light?.length).toBeGreaterThan(40);
    for (const key of [...(light ?? []), ...(dark ?? [])]) expect(key).toMatch(/^--ms-[a-z0-9-]+$/);
    for (const key of dark ?? []) expect(light, key).toContain(key);
  });

  it('mixes every colour from the brand and theme keys: no hex, no rgb, no tone key', () => {
    const body = uncomment(layer);
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(body).not.toMatch(/--d?tone-/);
    for (const rule of palette) {
      for (const [property, value] of rule.declarations) {
        if (property === '--ms-grain-opacity') {
          expect(value).toMatch(/^0\.\d+$/);
          continue;
        }
        expect(value, property).toMatch(/var\(--(?:brand|theme)-|white|black|transparent/);
      }
    }
  });
});
