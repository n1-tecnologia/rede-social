import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LINK_CLASS, LINK_URL_PATTERN, linkify, trimMatchedUrl } from '../src/index';

/**
 * The ONE auto-linker (T-04-43, T-07-60), re-homed from the feed in 07-09. These cases pin the rules
 * every caller relies on: only http/https becomes a link, links open in a new tab with the full
 * relationship set, markup stays text, and the ink is a parameter.
 */

function renderText(text: string, linkClassName?: string) {
  return render(<p>{linkify(text, linkClassName ? { linkClassName } : {})}</p>).container;
}

describe('linkify (@rede-social/ui)', () => {
  it('turns an http(s) URL into an anchor with the new-tab target and the rel set', () => {
    const container = renderText('veja https://exemplo.com/a?b=1 agora');
    const anchors = container.querySelectorAll('a');
    expect(anchors).toHaveLength(1);
    const anchor = anchors[0] as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe('https://exemplo.com/a?b=1');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(anchor.className).toBe(DEFAULT_LINK_CLASS);
    expect(container.textContent).toBe('veja https://exemplo.com/a?b=1 agora');
  });

  it('leaves a javascript: or data: URL as plain text', () => {
    const container = renderText('clique javascript:alert(1) ou data:text/html,oi');
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('clique javascript:alert(1) ou data:text/html,oi');
  });

  it('renders markup as the literal characters typed, never as HTML', () => {
    const container = renderText('<b>x</b> <script>alert(1)</script>');
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toBe('<b>x</b> <script>alert(1)</script>');
  });

  it('applies the linkClassName option (side-aware ink in chat)', () => {
    const container = renderText('https://exemplo.com', 'underline text-on-brand');
    expect(container.querySelector('a')?.className).toBe('underline text-on-brand');
  });

  it('pushes trailing sentence punctuation back into the text', () => {
    const container = renderText('veja https://exemplo.com.');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://exemplo.com');
    expect(container.textContent).toBe('veja https://exemplo.com.');
    expect(trimMatchedUrl('https://exemplo.com).')).toBe('https://exemplo.com');
  });

  it('exposes one global matcher (the feed re-exports this same object)', () => {
    expect(LINK_URL_PATTERN.flags).toContain('g');
    expect('https://a.b http://c.d ftp://e.f'.match(LINK_URL_PATTERN)).toEqual([
      'https://a.b',
      'http://c.d',
    ]);
  });
});
