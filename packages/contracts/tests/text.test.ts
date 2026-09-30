import { describe, expect, it } from 'vitest';
import { cutOnWord } from '../src/text';

const graphemes = (text: string) =>
  Array.from(new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(text)).length;

describe('cutOnWord (07-01: the notification excerpt and push body rule)', () => {
  it('returns exactly 80 graphemes unchanged, with no ellipsis', () => {
    const text = 'a'.repeat(40) + ' ' + 'b'.repeat(39);
    expect(graphemes(text)).toBe(80);
    expect(cutOnWord(text, 80)).toBe(text);
  });

  it('cuts 81 graphemes on a word boundary and appends the ellipsis', () => {
    const text = 'a'.repeat(40) + ' ' + 'b'.repeat(40);
    expect(graphemes(text)).toBe(81);
    const cut = cutOnWord(text, 80);
    expect(cut).toBe(`${'a'.repeat(40)}…`);
    expect(graphemes(cut)).toBeLessThanOrEqual(80);
  });

  it('never splits an emoji ZWJ sequence', () => {
    const family = '👨‍👩‍👧‍👦';
    const text = `${'x'.repeat(78)} ${family}${family}`;
    const cut = cutOnWord(text, 80);
    expect(cut.endsWith('…')).toBe(true);
    // Whatever survived, no family was cut into its code points.
    expect(cut.replaceAll(family, '')).not.toMatch(/‍/);
    // A single long run of emoji is cut on grapheme boundaries, never inside one.
    const run = family.repeat(90);
    const cutRun = cutOnWord(run, 80);
    expect(graphemes(cutRun)).toBe(80);
    expect(cutRun.slice(0, -1).replaceAll(family, '')).toBe('');
  });

  it('gives an empty string for empty or whitespace-only input', () => {
    expect(cutOnWord('', 80)).toBe('');
    expect(cutOnWord('   \n\t  ', 80)).toBe('');
  });

  it('collapses newlines to single spaces', () => {
    expect(cutOnWord('primeira linha\n\nsegunda linha', 80)).toBe('primeira linha segunda linha');
  });
});
