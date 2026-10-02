import type { LinkPreviewProvider } from '../contracts/index';

/**
 * The inline player's frame source (08-08, D-346, UI-D-282, T-08-42).
 *
 * Derived HERE, server-side, from the stored provider and URL, never from anything the unfurl
 * fetched: the result is one of exactly two canonical shapes, both on hosts the Content Security
 * Policy's `frame-src` names, with an id that passed a strict pattern. Anything that does not parse
 * cleanly yields null and the card stays the shipped external link, so no attacker-chosen URL can
 * ever become a frame source.
 *
 * - YouTube: `youtube.com`, `www.youtube.com`, `m.youtube.com` (`/watch?v=ID`, `/shorts/ID`,
 *   `/embed/ID`) and `youtu.be/ID`; ID is exactly 11 of `[A-Za-z0-9_-]`. The privacy-enhanced
 *   `youtube-nocookie.com` host is the frame.
 * - Vimeo: `vimeo.com`, `www.vimeo.com` with a numeric first path segment.
 * - `https:` only (`http:` is accepted and normalised); no credentials, no explicit port.
 */
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const YOUTUBE_SHORT_HOST = 'youtu.be';
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com']);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,12}$/;

function parse(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username !== '' || url.password !== '' || url.port !== '') return null;
    return url;
  } catch {
    return null;
  }
}

function youtubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  let candidate: string | null | undefined = null;
  if (host === YOUTUBE_SHORT_HOST) {
    candidate = segments.length === 1 ? segments[0] : null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === '/watch') candidate = url.searchParams.get('v');
    else if (segments.length === 2 && (segments[0] === 'shorts' || segments[0] === 'embed')) {
      candidate = segments[1];
    }
  }
  return candidate && YOUTUBE_ID.test(candidate) ? candidate : null;
}

function vimeoId(url: URL): string | null {
  if (!VIMEO_HOSTS.has(url.hostname.toLowerCase())) return null;
  const first = url.pathname.split('/').filter(Boolean)[0];
  return first && VIMEO_ID.test(first) ? first : null;
}

export function embedUrlFor(provider: LinkPreviewProvider | null, rawUrl: string): string | null {
  if (provider === null) return null;
  const url = parse(rawUrl);
  if (url === null) return null;
  if (provider === 'youtube') {
    const id = youtubeId(url);
    return id ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0` : null;
  }
  if (provider === 'vimeo') {
    const id = vimeoId(url);
    return id ? `https://player.vimeo.com/video/${id}?autoplay=1` : null;
  }
  return null;
}
