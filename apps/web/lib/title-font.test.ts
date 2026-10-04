import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GOOGLE_FONTS } from './google-fonts';
import {
  FONT_CATEGORIES,
  filterFonts,
  type GoogleFont,
  isFontFamilyName,
  sampleFontsHref,
  sampleWeight,
  titleFontHref,
  titleFontStack,
  titleWeight,
} from './title-font';
import { savedTitleFont } from './title-font-catalogue';

const ALL = [100, 200, 300, 400, 500, 600, 700, 800, 900];

describe('isFontFamilyName', () => {
  it('accepts the shapes Google uses', () => {
    for (const name of ['Poppins', 'Open Sans', 'M PLUS 1p', 'Source Sans 3']) {
      expect(isFontFamilyName(name)).toBe(true);
    }
  });

  it('refuses anything that could leave a quoted CSS value or a URL parameter', () => {
    for (const value of [
      '',
      ' Poppins',
      'Poppins ',
      'Open  Sans',
      'Pop"pins',
      "Pop'pins",
      'Poppins;color:red',
      'Poppins&text=x',
      'Poppins)',
      'Lóra',
      'a'.repeat(61),
      42,
      null,
      undefined,
    ]) {
      expect(isFontFamilyName(value)).toBe(false);
    }
  });
});

describe('weights', () => {
  it('draws the titles in 700 or the closest weight the family ships, the heavier on a tie', () => {
    expect(titleWeight(ALL)).toBe(700);
    expect(titleWeight([400])).toBe(400);
    expect(titleWeight([300, 500])).toBe(500);
    expect(titleWeight([400, 900])).toBe(900);
    expect(titleWeight([600, 800])).toBe(800);
  });

  it('shows the list in the regular weight or the closest one', () => {
    expect(sampleWeight(ALL)).toBe(400);
    expect(sampleWeight([300])).toBe(300);
    expect(sampleWeight([700, 900])).toBe(700);
  });
});

describe('Google stylesheet URLs', () => {
  it('asks for one family in its title weight, swapping from Manrope while it loads', () => {
    expect(titleFontHref(['Open Sans', 'sans', [300, 400, 500, 600, 700, 800]])).toBe(
      'https://fonts.googleapis.com/css2?family=Open+Sans:wght@700&display=swap',
    );
    expect(titleFontHref(['Bebas Neue', 'sans', [400]])).toBe(
      'https://fonts.googleapis.com/css2?family=Bebas+Neue:wght@400&display=swap',
    );
  });

  it('asks for a batch of the list with only the letters of its names', () => {
    const fonts: GoogleFont[] = [
      ['Buda', 'display', [300]],
      ['Bebas Neue', 'sans', [400]],
    ];
    expect(sampleFontsHref(fonts)).toBe(
      'https://fonts.googleapis.com/css2?family=Buda:wght@300&family=Bebas+Neue:wght@400&text=%20BNabdesu&display=swap',
    );
  });

  it('falls back to the app font in the CSS stack', () => {
    expect(titleFontStack('Poppins')).toBe('"Poppins", var(--font-manrope), system-ui, sans-serif');
  });
});

describe('filterFonts', () => {
  const fonts: GoogleFont[] = [
    ['Open Sans', 'sans', [400, 700]],
    ['Playfair Display', 'serif', [400, 700]],
    ['Lora', 'serif', [400, 700]],
    ['Pacifico', 'handwriting', [400]],
  ];
  const names = (list: GoogleFont[]) => list.map(([family]) => family);

  it('ignores case, spaces and accents, and keeps the catalogue order', () => {
    expect(names(filterFonts(fonts, 'playfair', 'all'))).toEqual(['Playfair Display']);
    expect(names(filterFonts(fonts, 'open sans', 'all'))).toEqual(['Open Sans']);
    expect(names(filterFonts(fonts, 'opensans', 'all'))).toEqual(['Open Sans']);
    expect(names(filterFonts(fonts, '  LÓRA ', 'all'))).toEqual(['Lora']);
    expect(names(filterFonts(fonts, '', 'all'))).toEqual(names(fonts));
  });

  it('narrows to one category', () => {
    expect(names(filterFonts(fonts, '', 'serif'))).toEqual(['Playfair Display', 'Lora']);
    expect(names(filterFonts(fonts, 'a', 'handwriting'))).toEqual(['Pacifico']);
    expect(filterFonts(fonts, 'zzz', 'all')).toEqual([]);
  });
});

describe('the generated catalogue', () => {
  it('is large, unique and only holds names safe for CSS and URLs', () => {
    expect(GOOGLE_FONTS.length).toBeGreaterThan(1000);
    const families = GOOGLE_FONTS.map(([family]) => family);
    expect(new Set(families).size).toBe(families.length);
    for (const [family, category, weights] of GOOGLE_FONTS) {
      expect(isFontFamilyName(family), family).toBe(true);
      expect(FONT_CATEGORIES, family).toContain(category);
      expect(weights.length, family).toBeGreaterThan(0);
      expect(
        [...weights].sort((a, b) => a - b),
        family,
      ).toEqual([...weights]);
      for (const weight of weights) {
        expect(Number.isInteger(weight) && weight >= 1 && weight <= 1000, family).toBe(true);
      }
    }
  });

  it('keeps the popular families and the app font, and leaves out what draws no letters', () => {
    const families = new Set(GOOGLE_FONTS.map(([family]) => family));
    for (const family of ['Roboto', 'Poppins', 'Montserrat', 'Playfair Display', 'Manrope']) {
      expect(families.has(family), family).toBe(true);
    }
    for (const family of GOOGLE_FONTS.map(([name]) => name)) {
      expect(/\b(?:icons?|symbols?|emoji)\b|barcode|redacted|charted/i.test(family), family).toBe(
        false,
      );
    }
    // A script whose name merely contains "icon" stays (it draws letters).
    expect(families.has('Niconne')).toBe(true);
    expect(GOOGLE_FONTS[0]?.[0]).toBe('Roboto');
  });
});

/**
 * 2026-10-03: the SAVED family as the app's layouts resolve it on the server (the member app never
 * downloads the catalogue): the stack for `--brand-title-font` and the one stylesheet to load, in
 * the title weight the family ships; `null` (Manrope) for the default, an unsafe name or a family the
 * catalogue does not know.
 */
describe('savedTitleFont (the app’s saved family, looked up on the server)', () => {
  it('answers the stack and the title-weight stylesheet of a catalogue family', () => {
    expect(savedTitleFont('Poppins')).toEqual({
      family: 'Poppins',
      stack: titleFontStack('Poppins'),
      href: 'https://fonts.googleapis.com/css2?family=Poppins:wght@700&display=swap',
    });
    const single = GOOGLE_FONTS.find(([, , weights]) => !weights.includes(700));
    if (!single) throw new Error('the catalogue has no family without a 700 weight');
    expect(savedTitleFont(single[0])?.href).toBe(titleFontHref(single));
  });

  it('keeps Manrope for the default, a name the contract refuses and an unknown family', () => {
    for (const family of [null, undefined, '', 'Manrope', 'Pop"pins', 'Nao Existe Esta Fonte']) {
      expect(savedTitleFont(family), String(family)).toBeNull();
    }
  });
});

/**
 * The stylesheet side, against a stub `document` (the suite runs in node): each `<link>` it appends is
 * recorded, and a test fires its `load` or `error` like the browser would. The module is imported
 * fresh per test, so its caches start empty.
 */
describe('Google stylesheets in the page', () => {
  type StubLink = EventTarget & {
    rel: string;
    href: string;
    referrerPolicy: string;
    dataset: Record<string, string>;
    removed: boolean;
    remove: () => void;
  };
  let links: StubLink[];

  beforeEach(() => {
    vi.resetModules();
    links = [];
    vi.stubGlobal('document', {
      createElement: () => {
        const link = Object.assign(new EventTarget(), {
          rel: '',
          href: '',
          referrerPolicy: '',
          dataset: {} as Record<string, string>,
          removed: false,
          remove() {
            link.removed = true;
          },
        });
        return link;
      },
      head: { append: (link: StubLink) => links.push(link) },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const fire = (link: StubLink | undefined, type: 'load' | 'error') =>
    link?.dispatchEvent(new Event(type));

  it('adds each stylesheet once, with no referrer, and resolves when it loads', async () => {
    const { ensureFontStylesheet } = await import('./title-font');
    const first = ensureFontStylesheet('https://fonts.googleapis.com/css2?family=Lora:wght@700');
    const again = ensureFontStylesheet('https://fonts.googleapis.com/css2?family=Lora:wght@700');
    expect(again).toBe(first);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ rel: 'stylesheet', referrerPolicy: 'no-referrer' });
    expect(links[0]?.dataset.googleFont).toBe('');
    fire(links[0], 'load');
    await expect(first).resolves.toBeUndefined();
  });

  it('drops a refused stylesheet and asks again on the next call', async () => {
    const { ensureFontStylesheet } = await import('./title-font');
    const href = 'https://fonts.googleapis.com/css2?family=Lora:wght@700';
    const refused = ensureFontStylesheet(href);
    fire(links[0], 'error');
    await expect(refused).rejects.toThrow();
    expect(links[0]?.removed).toBe(true);
    ensureFontStylesheet(href);
    expect(links).toHaveLength(2);
  });

  it('samples the list in batches of 20, once per family', async () => {
    const { loadFontSamples } = await import('./title-font');
    const fonts = GOOGLE_FONTS.slice(0, 45);
    loadFontSamples(fonts);
    expect(links).toHaveLength(3);
    expect(links.map((link) => new URL(link.href).searchParams.getAll('family').length)).toEqual([
      20, 20, 5,
    ]);
    loadFontSamples(fonts);
    expect(links).toHaveLength(3);
  });

  it('asks a refused batch one family at a time, and again later for one that failed too', async () => {
    const { loadFontSamples } = await import('./title-font');
    const fonts = GOOGLE_FONTS.slice(0, 20);
    loadFontSamples(fonts);
    fire(links[0], 'error');
    await settle();
    expect(links).toHaveLength(21);
    // Only the first family's own request fails (the network, not Google): it alone is asked again.
    fire(links[1], 'error');
    for (const link of links.slice(2)) fire(link, 'load');
    await settle();
    loadFontSamples(fonts);
    expect(links).toHaveLength(22);
    expect(new URL(links[21]?.href ?? '').searchParams.getAll('family')).toEqual([
      new URL(links[1]?.href ?? '').searchParams.get('family'),
    ]);
  });
});
