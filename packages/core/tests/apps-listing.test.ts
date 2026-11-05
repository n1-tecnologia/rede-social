import { TOGGLEABLE_MODULES } from '@rede-social/contracts';
import { describe, expect, it } from 'vitest';
import {
  AGE_RATING_ANSWERS,
  buildKeywords,
  buildReviewNotes,
  buildShortDescription,
  buildStoreDescription,
  buildStoreTitle,
  cutToLimit,
  ListingRefusal,
  PLAY_QUESTIONNAIRE_ANSWERS,
  STORE_LIMITS,
} from '../server/apps/listing';

/**
 * 13-31 Task 2 (D-607, T-13-56, NATIVE-29): the listing text, the review notes, the questionnaire answers and the
 * store-limit cuts are deterministic data. Limits are counted in Unicode code points, keywords in UTF-8 bytes.
 */

const points = (text: string) => [...text].length;
const chars = (...codes: number[]) => String.fromCharCode(...codes);
/** C0 controls other than tab and newline, DEL, C1 controls and the Unicode line and paragraph separators. */
const hasForbiddenControl = (text: string): boolean =>
  [...text].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return (
      code <= 0x08 ||
      (code >= 0x0b && code <= 0x1f) ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029
    );
  });
const bytes = (text: string) => Buffer.byteLength(text, 'utf8');
/** Words that would advertise a purchase, in either language the text can be written in. */
const PURCHASE_WORDS = /compra|comprar|preço|preco|loja|store|purchase|price|buy|pagamento|assin/i;

describe('buildStoreDescription: the standard text and one sentence per module (UI-D-626)', () => {
  it('with no module enabled it is the base text with the tenant name interpolated, and nothing else', () => {
    const { text, cut } = buildStoreDescription({ tenantName: 'Clube Aurora', modules: [] });
    expect(cut).toBe(false);
    expect(text).toBe(
      'Entre na comunidade de Clube Aurora direto do seu celular. Veja as novidades, curta e comente as publicações, participe de comunidades e eventos, converse com a equipe e receba avisos do que importa. Seu acesso é o mesmo da comunidade de Clube Aurora na web.',
    );
  });

  it('with events, communities and courses on it adds exactly those three sentences, in the fixed table order', () => {
    const base = buildStoreDescription({ tenantName: 'Clube Aurora', modules: [] }).text;
    const given = buildStoreDescription({
      tenantName: 'Clube Aurora',
      modules: ['courses', 'events', 'communities'],
    }).text;
    // The table order follows the contracts' module list: communities, events, courses.
    expect(given).toBe(
      `${base}\n\nEntre nas comunidades e acompanhe as conversas de cada uma.\nVeja a agenda de eventos, confirme sua presença e faça o check-in.\nAcesse os cursos e acompanhe o seu progresso.`,
    );
    const again = buildStoreDescription({
      tenantName: 'Clube Aurora',
      modules: ['events', 'courses', 'communities'],
    }).text;
    expect(again).toBe(given);
  });

  it('a module with no sentence adds nothing, and the store and payments modules never add a word about buying', () => {
    const base = buildStoreDescription({ tenantName: 'Clube Aurora', modules: [] }).text;
    for (const quiet of ['store', 'payments', 'social']) {
      expect(buildStoreDescription({ tenantName: 'Clube Aurora', modules: [quiet] }).text).toBe(
        base,
      );
    }
    const everything = buildStoreDescription({
      tenantName: 'Clube Aurora',
      modules: [...TOGGLEABLE_MODULES],
    }).text;
    expect(everything).not.toMatch(PURCHASE_WORDS);
    expect(buildStoreDescription({ tenantName: 'Clube Aurora', modules: [] }).text).not.toMatch(
      PURCHASE_WORDS,
    );
  });

  it('ignores a module key it does not know and a repeated key', () => {
    const once = buildStoreDescription({ tenantName: 'A Casa', modules: ['events'] }).text;
    const noisy = buildStoreDescription({
      tenantName: 'A Casa',
      modules: ['events', 'events', 'not-a-module'],
    }).text;
    expect(noisy).toBe(once);
  });
});

describe('store limits are enforced where the text is built (COVERAGE sections 3 and 4)', () => {
  it('names the limits of both stores', () => {
    expect(STORE_LIMITS).toMatchObject({
      appStoreName: 30,
      appStoreSubtitle: 30,
      appStoreDescription: 4000,
      appStoreKeywordsBytes: 100,
      playTitle: 30,
      playShortDescription: 80,
      playFullDescription: 4000,
    });
  });

  it('cuts a long description at a word boundary to 4000 code points and says so', () => {
    const tenantName = Array.from({ length: 700 }, (_, index) => `palavra${index}`).join(' ');
    const { text, cut } = buildStoreDescription({
      tenantName,
      modules: [...TOGGLEABLE_MODULES],
    });
    expect(cut).toBe(true);
    expect(points(text)).toBeLessThanOrEqual(4000);
    expect(text.endsWith(' ')).toBe(false);
    // Cut on a boundary: the text ends with a whole word of the name, never half of one.
    expect(text).toMatch(/palavra\d+$/);
    const last = text.slice(text.lastIndexOf('palavra'));
    expect(Number(last.replace('palavra', ''))).toBeLessThan(700);
  });

  it('cuts a keyword string to 100 UTF-8 bytes and never splits a code point', () => {
    // 34 characters of 3 bytes each is 102 bytes: it must lose one character, never half of one.
    const keywords = 'あ'.repeat(34);
    const cutResult = cutToLimit(keywords, { unit: 'bytes', max: 100 });
    expect(cutResult.cut).toBe(true);
    expect(points(cutResult.text)).toBeLessThanOrEqual(33);
    expect(points(cutResult.text)).toBe(33);
    expect(bytes(cutResult.text)).toBeLessThanOrEqual(100);
    expect(cutResult.text).toBe('あ'.repeat(33));
    // A string that fits is returned unchanged.
    expect(cutToLimit('abc,def', { unit: 'bytes', max: 100 })).toEqual({
      text: 'abc,def',
      cut: false,
    });
    // An emoji is one code point of 4 bytes.
    expect(cutToLimit('😀'.repeat(26), { unit: 'bytes', max: 100 }).text).toBe('😀'.repeat(25));
  });

  it('cuts at a comma or a space when there is one before the limit', () => {
    const { text, cut } = cutToLimit('alfa,beta,gamma,delta', { unit: 'codepoints', max: 12 });
    expect(cut).toBe(true);
    expect(text).toBe('alfa,beta');
  });

  it('keywords for a tenant fit 100 bytes, in bytes not characters', () => {
    const { text } = buildKeywords({ tenantName: 'Associação Brasileira de Cultura e Música' });
    expect(bytes(text)).toBeLessThanOrEqual(100);
    expect(text.startsWith('associação')).toBe(true);
    const wide = buildKeywords({ tenantName: `${'日本語'.repeat(12)} ${'あいう'.repeat(12)}` });
    expect(bytes(wide.text)).toBeLessThanOrEqual(100);
    expect(wide.cut).toBe(true);
  });

  it('a 31-character name is cut to 30 for the title fields and a short description to 80', () => {
    const thirtyOne = 'Comunidade Dos Amigos Do Bairro';
    expect(points(thirtyOne)).toBe(31);
    const title = buildStoreTitle(thirtyOne);
    expect(title.cut).toBe(true);
    expect(points(title.text)).toBeLessThanOrEqual(30);
    expect(buildStoreTitle('Clube Aurora')).toEqual({ text: 'Clube Aurora', cut: false });

    const short = buildShortDescription({ tenantName: 'N'.repeat(100) });
    expect(points(short.text)).toBeLessThanOrEqual(80);
    const normal = buildShortDescription({ tenantName: 'Clube Aurora' });
    expect(normal.cut).toBe(false);
    expect(points(normal.text)).toBeLessThanOrEqual(80);
    expect(normal.text).toContain('Clube Aurora');
  });
});

describe('buildReviewNotes: English notes for App Review (D-607, Apple 2.1(a))', () => {
  const notes = buildReviewNotes({ tenantName: 'Clube Aurora' }).text;

  it('is English and states the five things the reviewer needs', () => {
    expect(notes).toContain('Clube Aurora');
    expect(notes).toMatch(/demo account/i);
    expect(notes).toMatch(/purchases? .*outside the app/is);
    expect(notes).toMatch(/no price/i);
    expect(notes).toMatch(/call to action/i);
    for (const feature of ['push notifications', 'Face ID', 'share', 'offline']) {
      expect(notes.toLowerCase()).toContain(feature.toLowerCase());
    }
    expect(notes).toMatch(/Configurações/);
    expect(notes).toMatch(/14-day grace period/i);
    expect(notes).toMatch(/report/i);
    expect(notes).toMatch(/block/i);
    expect(notes).toMatch(/support chat/i);
  });

  it('never contains a password and interpolates only the tenant name', () => {
    expect(notes).not.toMatch(/password\s*[:=]/i);
    expect(notes).not.toMatch(/app-review\+/);
    expect(notes).not.toContain('{tenant}');
    const other = buildReviewNotes({ tenantName: 'Outra Casa' }).text;
    expect(other.replaceAll('Outra Casa', 'Clube Aurora')).toBe(notes);
  });

  it('escapes control characters in the tenant name and cannot re-expand a placeholder', () => {
    const hostile = buildReviewNotes({
      tenantName: `Casa${chars(0, 10, 13, 7)}{tenant}$&Verde${chars(0x2028)}`,
    }).text;
    expect(hasForbiddenControl(hostile)).toBe(false);
    expect(hostile).toContain('Casa {tenant}$&Verde');
    expect(points(hostile)).toBeLessThanOrEqual(4000);
  });
});

describe('the questionnaire answers (research OQ-3, planner assumption A-13-12)', () => {
  it('the age rating template answers are the researched defaults and the object is frozen', () => {
    expect(AGE_RATING_ANSWERS).toMatchObject({
      userGeneratedContent: true,
      messaging: true,
      unrestrictedWebAccess: false,
      advertising: false,
      parentalControls: false,
      ageAssurance: false,
      minimumAge: 13,
    });
    expect(Object.isFrozen(AGE_RATING_ANSWERS)).toBe(true);
    expect(() => {
      (AGE_RATING_ANSWERS as { minimumAge: number }).minimumAge = 4;
    }).toThrow();
  });

  it('the Play questionnaire answers are data, frozen, and say the web is not unrestricted', () => {
    expect(PLAY_QUESTIONNAIRE_ANSWERS).toMatchObject({
      usersInteract: true,
      sharesUserContent: true,
      unrestrictedWebAccess: false,
      containsAds: false,
      minimumAge: 13,
    });
    expect(Object.isFrozen(PLAY_QUESTIONNAIRE_ANSWERS)).toBe(true);
  });
});

describe('the tenant name (NATIVE-29 empty and encoding edges)', () => {
  it('an empty or blank tenant name throws a typed error from every builder', () => {
    for (const name of ['', '   ', '\n\t', '\u0000']) {
      expect(() => buildStoreDescription({ tenantName: name, modules: [] })).toThrow(
        ListingRefusal,
      );
      expect(() => buildReviewNotes({ tenantName: name })).toThrow(ListingRefusal);
      expect(() => buildKeywords({ tenantName: name })).toThrow(ListingRefusal);
      expect(() => buildStoreTitle(name)).toThrow(ListingRefusal);
      expect(() => buildShortDescription({ tenantName: name })).toThrow(ListingRefusal);
    }
    try {
      buildStoreTitle('');
    } catch (error) {
      expect((error as ListingRefusal).code).toBe('tenant_name_empty');
    }
  });

  it('an accented name and an emoji survive the builders unchanged', () => {
    const name = 'Açaí & Café 🎉 São João';
    expect(buildStoreDescription({ tenantName: name, modules: ['events'] }).text).toContain(name);
    expect(buildReviewNotes({ tenantName: name }).text).toContain(name);
    expect(buildStoreTitle(name).text).toBe(name);
    expect(buildShortDescription({ tenantName: name }).text).toContain(name);
  });
});

describe('property: no limit is exceeded for 200 generated tenant names', () => {
  // A small deterministic generator, so a failure names a reproducible input.
  let seed = 20261105;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const PIECES = [
    'Clube',
    'Casa',
    'Açaí',
    'São',
    'Música',
    '🎉',
    '😀',
    '日本語',
    'あいう',
    'a',
    'Z',
    '  ',
    ',',
    '{tenant}',
    '$&',
    'Associação',
    'x'.repeat(40),
  ];
  const generate = () => {
    const parts = Math.floor(next() * 40) + 1;
    let name = '';
    for (let index = 0; index < parts; index += 1) {
      name += `${PIECES[Math.floor(next() * PIECES.length)]}${next() < 0.7 ? ' ' : ''}`;
    }
    return name.trim() === '' ? 'Casa' : name;
  };

  it('every field stays within its store limit and never splits a code point', () => {
    const modules = [...TOGGLEABLE_MODULES];
    for (let index = 0; index < 200; index += 1) {
      const tenantName = generate();
      const fields = {
        description: buildStoreDescription({ tenantName, modules }),
        notes: buildReviewNotes({ tenantName }),
        keywords: buildKeywords({ tenantName }),
        title: buildStoreTitle(tenantName),
        short: buildShortDescription({ tenantName }),
      };
      expect(
        points(fields.description.text),
        `description of ${JSON.stringify(tenantName)}`,
      ).toBeLessThanOrEqual(4000);
      expect(points(fields.notes.text)).toBeLessThanOrEqual(4000);
      expect(
        bytes(fields.keywords.text),
        `keywords of ${JSON.stringify(tenantName)}`,
      ).toBeLessThanOrEqual(100);
      expect(
        points(fields.title.text),
        `title of ${JSON.stringify(tenantName)}`,
      ).toBeLessThanOrEqual(30);
      expect(
        points(fields.short.text),
        `short of ${JSON.stringify(tenantName)}`,
      ).toBeLessThanOrEqual(80);
      for (const field of Object.values(fields)) {
        // No lone surrogate: re-encoding is lossless.
        expect(Buffer.from(field.text, 'utf8').toString('utf8')).toBe(field.text);
        expect(hasForbiddenControl(field.text)).toBe(false);
      }
    }
  });
});
