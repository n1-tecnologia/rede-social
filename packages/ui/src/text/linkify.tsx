import type { ReactNode } from 'react';
import { LINK_URL_PATTERN, trimMatchedUrl } from './url';

/**
 * THE auto-linker for every piece of authored text the product renders: the post caption (D-54), the
 * comment body (04-07), the reel caption (05.3) and the chat bubble (07-09, D-225). One
 * implementation, re-homed here from the feed module in 07-09 because the chat module may not import
 * another module (MOD-02); the feed re-exports it, so its callers are unchanged.
 *
 * A copy would be the exact drift the threat register warns about (T-04-43, T-07-60): two linkers
 * would eventually disagree about which schemes may become an `href` or which link relationship
 * attributes go on it, and the weaker one would be the one somebody can post into.
 *
 * THREE RULES THIS FILE EXISTS TO HOLD:
 *
 * 1. **Never an HTML-injection sink.** No raw-HTML escape hatch is used here. Text is returned as
 *    plain strings that React escapes, so text containing `<script>` renders as the characters typed.
 * 2. **Links are built at RENDER time, from a matcher that only accepts `http:`/`https:`.** The
 *    `href` is a substring that already matched `https?://…`, so a `javascript:` or `data:` URL can
 *    never reach it: it simply is not a link and renders as text. Every link opens in a new tab with
 *    the no-opener, no-referrer and no-follow relationship set below.
 * 3. **The matcher is the shared one** (`./url`), the same the feed's create path unfurls with.
 */

/** The feed's historical ink: brand text, underline on hover. */
export const DEFAULT_LINK_CLASS = 'text-brand underline-offset-2 hover:underline';

export interface LinkifyOptions {
  /**
   * The link ink. Side-aware in chat (UI-D-259): `underline text-on-brand` inside an own bubble,
   * the default brand ink everywhere else.
   */
  linkClassName?: string;
}

/**
 * Splits `text` into plain runs and `<a>` elements. Keys carry the match offset, so they are stable
 * across re-renders and no array index is used as a key.
 */
export function linkify(text: string, options: LinkifyOptions = {}): ReactNode[] {
  const className = options.linkClassName ?? DEFAULT_LINK_CLASS;
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(LINK_URL_PATTERN)) {
    const start = match.index;
    const url = trimMatchedUrl(match[0]);
    if (url.length === 0) continue;

    if (start > cursor) nodes.push(text.slice(cursor, start));
    nodes.push(
      <a
        key={`link-${start}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className={className}
      >
        {url}
      </a>,
    );
    cursor = start + url.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
