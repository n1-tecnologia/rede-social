// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { type AnswerDef, type AnswerWords, answerView } from '@/lib/profile-form/answer-view';
import { AnswerValue } from './AnswerValue';

/**
 * 12-14 Task 1 (UI-D-591, T-12-32): the answer renderer. Everything is React text; the anchor carries
 * the exact attributes; the stars are decorative; markup-looking text stays text.
 */

afterEach(cleanup);

const words: AnswerWords = {
  yes: 'Sim',
  no: 'Não',
  accepted: 'Aceito',
  other: (text) => `Outro: ${text}`,
  rating: (n) => `${n} de 5`,
};
const def = (type: AnswerDef['type']): AnswerDef => ({ type, options: [] });

describe('AnswerValue', () => {
  it('renders text keeping line breaks and wrapping long words', () => {
    const view = answerView(def('long_text'), 'Linha 1\nLinha 2', words);
    if (!view) throw new Error('no view');
    const { container } = render(<AnswerValue view={view} />);
    const span = container.querySelector('span');
    expect(span?.textContent).toBe('Linha 1\nLinha 2');
    expect(span?.className).toContain('whitespace-pre-line');
    expect(span?.className).toContain('break-words');
  });

  it('renders the link anchor with the exact attributes and the external-link icon', () => {
    const view = answerView(def('link'), 'https://instagram.com/marina', words);
    if (!view) throw new Error('no view');
    render(<AnswerValue view={view} />);
    const anchor = screen.getByRole('link');
    expect(anchor.getAttribute('href')).toBe('https://instagram.com/marina');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer nofollow ugc');
    expect(anchor.className).toContain('text-brand');
    expect(anchor.className).toContain('underline');
    expect(anchor.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(anchor.querySelector('svg')?.getAttribute('width')).toBe('14');
  });

  it('renders a javascript: address as text with no anchor at all', () => {
    const view = answerView(def('link'), 'javascript:alert(1)', words);
    if (!view) throw new Error('no view');
    const { container } = render(<AnswerValue view={view} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('javascript:alert(1)');
  });

  it('renders an e-mail as plain text, not mailto', () => {
    const view = answerView(def('email'), 'nome@exemplo.com.br', words);
    if (!view) throw new Error('no view');
    const { container } = render(<AnswerValue view={view} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('nome@exemplo.com.br');
  });

  it('renders the rating as words plus five aria-hidden stars filled up to n', () => {
    const view = answerView(def('rating'), 4, words);
    if (!view) throw new Error('no view');
    const { container } = render(<AnswerValue view={view} />);
    expect(container.textContent).toBe('4 de 5');
    const stars = container.querySelectorAll('svg');
    expect(stars).toHaveLength(5);
    for (const star of stars) expect(star.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('[data-rating-stars]')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(container.querySelectorAll('[data-filled]')).toHaveLength(4);
  });

  it('never turns markup-looking text into elements', () => {
    const hostile = '<img src=x onerror=alert(1)><b>negrito</b>';
    const view = answerView(def('short_text'), hostile, words);
    if (!view) throw new Error('no view');
    const { container } = render(<AnswerValue view={view} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toBe(hostile);
  });
});
