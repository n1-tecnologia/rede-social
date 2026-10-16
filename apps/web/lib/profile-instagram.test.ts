import { bioSchema, MAX_BIO_LENGTH, normaliseBio } from '@rede-social/contracts/profiles';
import { describe, expect, it } from 'vitest';
import {
  bioRoom,
  cleanInstagramInput,
  composeProfileBio,
  INSTAGRAM_HANDLE_MAX,
  instagramCost,
  instagramLabel,
  instagramUrl,
  isInstagramHandle,
  parseInstagramInput,
  profileRowSnippet,
  splitProfileBio,
} from '@/lib/profile-instagram';

/**
 * 2026-10-09 — the Instagram handle stored inside the bio (front only, the `event-extras.ts`
 * precedent). The claims worth a test:
 *
 *  1. **Instagram's shape, forgiving input.** A handle is 1-30 of `a-z0-9._`, with no period first,
 *     last or twice; a pasted profile link becomes its handle, one `@` goes, the case folds; a post or
 *     Reel link, a space, an accent or an emoji is invalid.
 *  2. **An exact round trip.** Every text × handle pair composes to a string the API's own
 *     normaliser leaves as it is, and splits back to the same pair.
 *  3. **Plain bios stay plain.** Anything that is not exactly what `composeProfileBio` writes is text.
 *  4. **The counter and the API agree.** A text of exactly `bioRoom` units beside a handle passes the
 *     API's `bioSchema`; one unit more is refused (an emoji is two units on both sides).
 *  5. **The directory row** shows the visible bio's first line, else the `@handle`.
 */

describe('isInstagramHandle and parseInstagramInput — the handle (1)', () => {
  it.each([
    'seuperfil',
    'seu.perfil',
    'seu_perfil',
    '_seuperfil_',
    'a',
    '1234',
    'a'.repeat(INSTAGRAM_HANDLE_MAX),
  ])('%s is a handle', (value) => {
    expect(isInstagramHandle(value)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['a leading period', '.seuperfil'],
    ['a trailing period', 'seuperfil.'],
    ['two periods in a row', 'seu..perfil'],
    ['a space', 'seu perfil'],
    ['a hyphen', 'seu-perfil'],
    ['uppercase (stored handles are lowercase)', 'SeuPerfil'],
    ['an @ (stored handles carry none)', '@seuperfil'],
    ['an accent', 'joão'],
    ['an emoji', 'seuperfil😀'],
    ['31 characters', 'a'.repeat(INSTAGRAM_HANDLE_MAX + 1)],
  ])('%s is not a handle', (_reason, value) => {
    expect(isInstagramHandle(value)).toBe(false);
  });

  it.each([
    ['seuperfil', 'seuperfil'],
    ['  @SeuPerfil  ', 'seuperfil'],
    ['https://www.instagram.com/seuperfil/?igsh=MWx0aDZ1ZzQ=', 'seuperfil'],
    ['https://instagram.com/Seu.Perfil', 'seu.perfil'],
    ['http://instagram.com/seuperfil/', 'seuperfil'],
    ['instagram.com/seuperfil', 'seuperfil'],
    ['www.instagram.com/seuperfil?hl=pt-br', 'seuperfil'],
    ['https://m.instagram.com/seuperfil', 'seuperfil'],
    ['https://instagr.am/seuperfil', 'seuperfil'],
    ['https://www.instagram.com/@seuperfil', 'seuperfil'],
    ['HTTPS://WWW.INSTAGRAM.COM/SEUPERFIL/#bio', 'seuperfil'],
    ['https://www.instagram.com/reelsdaana/', 'reelsdaana'],
  ])('%s reads as the handle %s', (raw, handle) => {
    expect(parseInstagramInput(raw)).toEqual({ status: 'valid', handle });
  });

  it.each([
    ['https://www.instagram.com/p/C1a2b3c4d5e/'],
    ['https://www.instagram.com/reel/C1a2b3c4d5e/?igsh=x'],
    ['https://www.instagram.com/reels/'],
    ['https://www.instagram.com/stories/seuperfil/123/'],
    ['https://www.instagram.com/seuperfil/tagged/'],
    ['https://instagram.com.example.com/seuperfil'],
    ['https://example.com/instagram.com/seuperfil'],
    ['seu perfil'],
    ['@@seuperfil'],
    ['seu..perfil'],
  ])('%s is invalid, and keeps its cleaned candidate', (raw) => {
    const result = parseInstagramInput(raw);
    expect(result.status).toBe('invalid');
    expect(result).toEqual({ status: 'invalid', candidate: cleanInstagramInput(raw) });
  });

  it('nothing, blanks or a lone @ are empty', () => {
    expect(parseInstagramInput('')).toEqual({ status: 'empty' });
    expect(parseInstagramInput('   ')).toEqual({ status: 'empty' });
    expect(parseInstagramInput(' @ ')).toEqual({ status: 'empty' });
  });

  it('the label and the address are built from the handle alone', () => {
    expect(instagramLabel('seu.perfil')).toBe('@seu.perfil');
    expect(instagramUrl('seu.perfil')).toBe('https://instagram.com/seu.perfil');
  });
});

describe('composeProfileBio and splitProfileBio — the round trip (2)', () => {
  const TEXTS = [
    '',
    'Corro aos domingos.',
    'Fotógrafa.\nSempre com a câmera na mochila.',
    'Primeiro parágrafo.\n\nSegundo parágrafo.',
    'Com emoji 😀 e acentuação: ç, ã, é.',
    'Instagram: @outro',
  ];
  const HANDLES = ['seuperfil', 'a', 'seu.perfil_2', 'a'.repeat(INSTAGRAM_HANDLE_MAX)];

  for (const text of TEXTS) {
    for (const handle of HANDLES) {
      it(`${JSON.stringify(text)} with @${handle}`, () => {
        const stored = composeProfileBio(text, handle);
        // What the API's normaliser keeps byte for byte, so the row holds exactly this.
        expect(normaliseBio(stored)).toBe(stored);
        expect(splitProfileBio(stored)).toEqual({ text, instagram: handle });
      });
    }
  }

  it('the line closes the bio after a blank line, or is the whole bio', () => {
    expect(composeProfileBio('Corro aos domingos.', 'seuperfil')).toBe(
      'Corro aos domingos.\n\nInstagram: @seuperfil',
    );
    expect(composeProfileBio('', 'seuperfil')).toBe('Instagram: @seuperfil');
  });

  it('the text is normalised the way the API stores it before the line is added', () => {
    expect(composeProfileBio('  Oi\r\n\r\n\r\ntudo bem?  \n', 'seuperfil')).toBe(
      'Oi\n\ntudo bem?\n\nInstagram: @seuperfil',
    );
  });

  it('no handle, or an invalid one, stores the text alone', () => {
    expect(composeProfileBio('  Corro.  ', null)).toBe('Corro.');
    expect(composeProfileBio('Corro.', 'Seu Perfil')).toBe('Corro.');
    expect(composeProfileBio('', null)).toBe('');
  });
});

describe('splitProfileBio — plain bios stay plain (3)', () => {
  it.each([
    ['no bio', null, ''],
    ['an ordinary bio', 'Organizo os encontros de sábado.', 'Organizo os encontros de sábado.'],
    ['an uppercase handle', 'Oi\n\nInstagram: @SeuPerfil', 'Oi\n\nInstagram: @SeuPerfil'],
    ['an invalid handle', 'Oi\n\nInstagram: @seu perfil', 'Oi\n\nInstagram: @seu perfil'],
    ['a single line break', 'Oi\nInstagram: @seuperfil', 'Oi\nInstagram: @seuperfil'],
    ['another label', 'Oi\n\nInsta: @seuperfil', 'Oi\n\nInsta: @seuperfil'],
    ['the line in the middle', 'Instagram: @seuperfil\n\nOi', 'Instagram: @seuperfil\n\nOi'],
    [
      'text before the line, unnormalised',
      'Oi  \n\nInstagram: @seuperfil',
      'Oi  \n\nInstagram: @seuperfil',
    ],
    ['a handle with an @ left over', 'Instagram: @@seuperfil', 'Instagram: @@seuperfil'],
  ])('%s', (_reason, stored, text) => {
    expect(splitProfileBio(stored)).toEqual({ text, instagram: null });
  });

  it('the LAST line is the handle when the text itself mentions one', () => {
    expect(splitProfileBio('Instagram: @antigo\n\nInstagram: @novo')).toEqual({
      text: 'Instagram: @antigo',
      instagram: 'novo',
    });
  });
});

describe('bioRoom — the counter agrees with the API (4)', () => {
  const HANDLE = 'seu.perfil';

  it('the line costs the blank line, the prefix and the handle', () => {
    expect(instagramCost(null)).toBe(0);
    expect(instagramCost(HANDLE)).toBe(2 + 12 + HANDLE.length);
    expect(bioRoom(null)).toBe(MAX_BIO_LENGTH);
    expect(bioRoom(HANDLE)).toBe(MAX_BIO_LENGTH - 14 - HANDLE.length);
    // A candidate mid-edit never shrinks the room below the longest valid handle's.
    expect(bioRoom('x'.repeat(INSTAGRAM_HANDLE_MAX + 50))).toBe(MAX_BIO_LENGTH - 14 - 30);
  });

  it.each([
    ['ASCII', (length: number) => 'a'.repeat(length)],
    ['ending on an emoji (two units)', (length: number) => `${'a'.repeat(length - 2)}😀`],
  ])('%s: room units pass bioSchema, room + 1 are refused', (_kind, textOf) => {
    const room = bioRoom(HANDLE);
    const fits = composeProfileBio(textOf(room), HANDLE);
    expect(fits.length).toBe(MAX_BIO_LENGTH);
    expect(bioSchema.safeParse(fits)).toEqual({ success: true, data: fits });

    const over = composeProfileBio(textOf(room + 1), HANDLE);
    expect(over.length).toBe(MAX_BIO_LENGTH + 1);
    expect(bioSchema.safeParse(over).success).toBe(false);
  });

  it('the longest valid handle alone always fits', () => {
    const alone = composeProfileBio('', 'a'.repeat(INSTAGRAM_HANDLE_MAX));
    expect(bioSchema.safeParse(alone).success).toBe(true);
  });
});

describe('profileRowSnippet — the directory row (5)', () => {
  it('the visible bio’s first line, never the stored line', () => {
    expect(profileRowSnippet('Corro.\nTodo domingo.\n\nInstagram: @seuperfil')).toBe('Corro.');
  });

  it('the @handle when there is no visible text', () => {
    expect(profileRowSnippet('Instagram: @seuperfil')).toBe('@seuperfil');
  });

  it('nothing for no bio, and a plain bio’s first line', () => {
    expect(profileRowSnippet(null)).toBeNull();
    expect(profileRowSnippet('Professor de história.\nE de geografia.')).toBe(
      'Professor de história.',
    );
  });
});
