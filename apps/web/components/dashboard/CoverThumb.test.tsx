// @vitest-environment happy-dom
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import {
  COVER_ICON,
  COVER_TONES,
  type CoverKind,
  CoverThumb,
  type CoverThumbProps,
  coverStyle,
  coverTone,
} from './CoverThumb';
import type { DashboardT } from './format';

/**
 * The publication thumbnail of the lists (quick 261013-orf D-02/D-04) on the REAL pt-BR catalog:
 * decorative, the brand pair at one of five angles per publication, the kind's icon, a video's
 * length and a story's ring (quick 261013-uoi F-5/F-6).
 */

afterEach(cleanup);

// A path join, not `new URL(…, import.meta.url)`: happy-dom replaces the global URL.
const catalogDir = join(dirname(fileURLToPath(import.meta.url)), '../../messages/pt-BR/');
const messages = loadMessages(catalogDir) as Record<string, unknown>;
const { createTranslator } = await import('next-intl');
const t = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'dashboard',
  // any: the untyped test translator stands in for the app's typed DashboardT (BandMembers.test).
} as never) as unknown as DashboardT;

function thumb(props: CoverThumbProps): HTMLElement {
  const { container } = render(<CoverThumb t={t} {...props} />);
  const el = container.querySelector<HTMLElement>('[data-testid="cover-thumb"]');
  if (!el) throw new Error('no cover thumb');
  return el;
}

describe('coverTone', () => {
  it('is stable per seed and always one of the five positions', () => {
    for (const seed of ['p01', 'op-41', 'v12', 'e3', 'x']) {
      expect(coverTone(seed)).toBe(coverTone(seed));
      expect(COVER_TONES).toContain(coverTone(seed));
    }
  });

  it('gives five distinct tones to p01..p05', () => {
    const tones = ['p01', 'p02', 'p03', 'p04', 'p05'].map(coverTone);
    expect(new Set(tones).size).toBe(5);
  });
});

describe('coverStyle (quick 261013-uoi F-6)', () => {
  it('turns the brand pair by one of five angles, with brand tokens only', () => {
    const images = ['p01', 'p02', 'p03', 'p04', 'p05'].map(
      (seed) => coverStyle(seed).backgroundImage,
    );
    for (const image of images) {
      expect(image).toMatch(
        /^linear-gradient\(\d+deg, color-mix\(in oklch, var\(--brand-primary\) \d+%, var\(--brand-on-primary-dark\)\), var\(--brand-secondary\)\)$/,
      );
    }
    expect(new Set(images).size).toBe(5);
    const angles = new Set(COVER_TONES);
    expect(angles.size).toBe(5);
    const style = coverStyle('p01');
    expect(style.color).toBe('var(--brand-on-primary)');
    expect(style.backgroundSize).toBeUndefined();
    expect(style.backgroundPosition).toBeUndefined();
  });
});

describe('CoverThumb (row)', () => {
  it('a video is a decorative 56 px square with its icon, its length and a brand tone', () => {
    const el = thumb({ kind: 'video', seed: 'p01', durationSeconds: 612 });
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.dataset.kind).toBe('video');
    for (const name of ['size-14', 'rounded-lg', 'shrink-0']) expect(el.classList).toContain(name);
    expect(el.textContent).toBe('10:12');
    expect(el.querySelectorAll('svg')).toHaveLength(1);
    // The test DOM drops `color-mix`, so the paint is checked on `coverStyle` and the tone here.
    expect(el.dataset.tone).toBe(String(coverTone('p01')));
    expect(el.querySelector('svg')?.getAttribute('class')).toContain('lucide-play');
  });

  it('a text post has the text icon, no badge and no ring', () => {
    const el = thumb({ kind: 'text', seed: 'p06', durationSeconds: null });
    expect(el.querySelectorAll('svg')).toHaveLength(1);
    expect(el.textContent).toBe('');
    expect(el.className).not.toContain('ring-2');
  });

  it('a photo has no length badge', () => {
    const el = thumb({ kind: 'photo', seed: 'p10' });
    expect(el.textContent).toBe('');
    expect(el.querySelectorAll('svg')).toHaveLength(1);
  });

  it('a story is a circle with the brand ring and its own icon, no badge (quick 261013-uoi F-5)', () => {
    for (const variant of ['row', 'card'] as const) {
      const el = thumb({ kind: 'story', seed: 's01', variant, ratio: 9 / 16 });
      expect(el.className, variant).toContain('ring-2');
      expect(el.classList, variant).toContain('rounded-full');
      expect(el.classList, variant).not.toContain('rounded-lg');
      expect(el.querySelector('svg')?.getAttribute('class'), variant).toContain('lucide-aperture');
      expect(el.textContent, variant).toBe('');
      if (variant === 'card') expect(el.dataset.ratio).toBe('1');
      cleanup();
    }
  });

  it('a video stays a rounded square with the play icon', () => {
    const el = thumb({ kind: 'video', seed: 'op-41', variant: 'card', ratio: 9 / 16 });
    expect(el.classList).toContain('rounded-lg');
    expect(el.classList).not.toContain('rounded-full');
    expect(el.querySelector('svg')?.getAttribute('class')).toContain('lucide-play');
  });
});

describe('CoverThumb (card, quick 261013-uoi F-3)', () => {
  function column(el: HTMLElement): HTMLElement {
    const parent = el.parentElement;
    if (!parent) throw new Error('no column');
    return parent;
  }

  it('sits in a fixed 4.5rem column, min(4.5, 7 × ratio) rem wide at its ratio', () => {
    // The DOM normalizes `4.500rem` to `4.5rem`, so the width is read back as a number of rem.
    const cases: [number | null, number, string][] = [
      [9 / 16, 3.938, '0.5625'],
      [16 / 9, 4.5, String(16 / 9)],
      [null, 4.5, '1'],
    ];
    for (const [ratio, width, dataRatio] of cases) {
      const el = thumb({
        kind: 'video',
        seed: 'op-41',
        variant: 'card',
        ratio,
        durationSeconds: 41,
      });
      for (const name of ['w-[4.5rem]', 'shrink-0', 'flex', 'justify-center']) {
        expect(column(el).classList, `${ratio} ${name}`).toContain(name);
      }
      expect(el.dataset.ratio, String(ratio)).toBe(dataRatio);
      expect(el.style.width, String(ratio)).toMatch(/^[\d.]+rem$/);
      expect(Number.parseFloat(el.style.width), String(ratio)).toBe(width);
      expect(el.style.maxWidth, String(ratio)).toBe('');
      expect(el.getAttribute('style') ?? '', String(ratio)).toContain(`aspect-ratio: ${dataRatio}`);
      expect(el.classList).not.toContain('size-14');
      const badge = el.querySelector('span');
      expect(badge?.textContent).toBe('0:41');
      expect(badge?.classList).toContain('text-xs');
      cleanup();
    }
  });

  it('a landscape card keeps its icon left of the length badge, never under it', () => {
    const wide = thumb({
      kind: 'video',
      seed: 'op-37',
      variant: 'card',
      ratio: 16 / 9,
      durationSeconds: 1620,
    });
    expect(wide.classList).toContain('justify-start');
    expect(wide.querySelector('svg')?.getAttribute('width')).toBe('18');
    const badge = wide.querySelector('span');
    for (const name of ['right-1', 'bottom-1', 'leading-4'])
      expect(badge?.classList).toContain(name);
    cleanup();
    const tall = thumb({
      kind: 'video',
      seed: 'op-41',
      variant: 'card',
      ratio: 9 / 16,
      durationSeconds: 41,
    });
    expect(tall.classList).toContain('justify-center');
    expect(tall.querySelector('svg')?.getAttribute('width')).toBe('28');
  });

  it('a card-sized text post is a square with its icon', () => {
    const el = thumb({ kind: 'text', seed: 'op-19', variant: 'card', ratio: null });
    expect(el.dataset.ratio).toBe('1');
    expect(el.querySelectorAll('svg')).toHaveLength(1);
  });

  it('an event check-in and an order have their own icon and kind', () => {
    for (const kind of ['event', 'order'] as const) {
      const el = thumb({ kind, seed: 'e3' });
      expect(el.dataset.kind).toBe(kind);
      expect(el.querySelectorAll('svg')).toHaveLength(1);
      cleanup();
    }
  });
});

describe('CoverThumb (strip and banner, quick 261014-ia8 F-7)', () => {
  it('a strip is a low full-width band, a banner a full-width 16:7, both decorative brand covers', () => {
    const cases = [
      ['strip', 'h-16'],
      ['banner', 'aspect-[16/7]'],
    ] as const;
    for (const [variant, shape] of cases) {
      const el = thumb({ kind: 'community', seed: 's2', variant });
      expect(el.getAttribute('aria-hidden'), variant).toBe('true');
      expect(el.dataset.kind, variant).toBe('community');
      expect(el.dataset.tone, variant).toBe(String(coverTone('s2')));
      for (const name of ['w-full', shape]) {
        expect(el.classList, `${variant} ${name}`).toContain(name);
      }
      // The Card clips its corners: the band has none of its own, nor the row's square.
      for (const name of ['rounded-lg', 'size-14']) {
        expect(el.classList, `${variant} ${name}`).not.toContain(name);
      }
      expect(el.querySelectorAll('svg'), variant).toHaveLength(1);
      expect(el.style.color, variant).toBe('var(--brand-on-primary)');
      cleanup();
    }
  });

  it('gives each product and each event format its own icon, unlike every other kind', () => {
    const icons: [CoverKind, string][] = [
      ['community', 'lucide-users'],
      ['mentoring', 'lucide-graduation-cap'],
      ['ebook', 'lucide-book-open'],
      ['recorded', 'lucide-monitor-play'],
      ['in_person', 'lucide-map-pin'],
      ['online', 'lucide-video'],
    ];
    for (const [kind, icon] of icons) {
      const el = thumb({ kind, seed: 'e1', variant: 'strip' });
      expect(el.querySelector('svg')?.getAttribute('class'), kind).toContain(icon);
      cleanup();
    }
    const all = Object.values(COVER_ICON);
    expect(new Set(all).size).toBe(all.length);
  });
});
