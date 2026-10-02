import { describe, expect, it } from 'vitest';
import { embedUrlFor } from '../server/embed-url';

/** The strict frame-source derivation (08-08, UI-D-282, T-08-42). */
const YT = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0';

describe('embedUrlFor — YouTube', () => {
  it.each([
    ['watch', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['watch without www', 'https://youtube.com/watch?v=dQw4w9WgXcQ'],
    ['mobile watch', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['youtu.be', 'https://youtu.be/dQw4w9WgXcQ'],
    ['shorts', 'https://www.youtube.com/shorts/dQw4w9WgXcQ'],
    ['embed', 'https://www.youtube.com/embed/dQw4w9WgXcQ'],
    ['extra query parameters', 'https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=42s'],
    ['youtu.be with a timestamp', 'https://youtu.be/dQw4w9WgXcQ?si=abc&t=10'],
    ['http normalised', 'http://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['upper-case host', 'https://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ'],
  ])('%s → the youtube-nocookie embed', (_name, url) => {
    expect(embedUrlFor('youtube', url)).toBe(YT);
  });

  it.each([
    ['an id of the wrong length', 'https://www.youtube.com/watch?v=dQw4w9WgXc'],
    ['an id that is too long', 'https://youtu.be/dQw4w9WgXcQx'],
    ['an id with a forbidden character', 'https://www.youtube.com/watch?v=dQw4w9WgX%22'],
    ['a lookalike host', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'],
    ['a subdomain lookalike', 'https://evil.youtube.com.example/embed/dQw4w9WgXcQ'],
    ['javascript:', 'javascript:alert(1)//https://youtu.be/dQw4w9WgXcQ'],
    ['data:', 'data:text/html,https://youtu.be/dQw4w9WgXcQ'],
    ['credentials', 'https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['an explicit port', 'https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ'],
    ['a channel page', 'https://www.youtube.com/@somechannel'],
    ['a playlist', 'https://www.youtube.com/playlist?list=PL0123456789'],
    ['a watch page with no id', 'https://www.youtube.com/watch'],
    ['an extra path segment', 'https://www.youtube.com/embed/dQw4w9WgXcQ/extra'],
    ['not a URL', 'not a url'],
  ])('%s → null', (_name, url) => {
    expect(embedUrlFor('youtube', url)).toBeNull();
  });
});

describe('embedUrlFor — Vimeo', () => {
  it.each([
    ['vimeo.com', 'https://vimeo.com/76979871'],
    ['www.vimeo.com', 'https://www.vimeo.com/76979871'],
    ['extra query parameters', 'https://vimeo.com/76979871?share=copy'],
  ])('%s → the player embed', (_name, url) => {
    expect(embedUrlFor('vimeo', url)).toBe('https://player.vimeo.com/video/76979871?autoplay=1');
  });

  it.each([
    ['a channel URL without a numeric id', 'https://vimeo.com/channels/staffpicks'],
    ['a user page', 'https://vimeo.com/someuser'],
    ['a lookalike host', 'https://vimeo.com.evil.example/76979871'],
    ['javascript:', 'javascript:alert(1)'],
    ['an id that is not numeric', 'https://vimeo.com/7697e871'],
  ])('%s → null', (_name, url) => {
    expect(embedUrlFor('vimeo', url)).toBeNull();
  });
});

describe('embedUrlFor — provider and host must agree', () => {
  it('a YouTube URL stored as vimeo, a Vimeo URL stored as youtube, and no provider → null', () => {
    expect(embedUrlFor('vimeo', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(embedUrlFor('youtube', 'https://vimeo.com/76979871')).toBeNull();
    expect(embedUrlFor(null, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('only ever yields one of the two frame-src hosts', () => {
    for (const [provider, url] of [
      ['youtube', 'https://youtu.be/dQw4w9WgXcQ'],
      ['vimeo', 'https://vimeo.com/1'],
    ] as const) {
      const out = embedUrlFor(provider, url);
      expect(out && new URL(out).origin).toMatch(
        /^https:\/\/(www\.youtube-nocookie\.com|player\.vimeo\.com)$/,
      );
    }
  });
});
