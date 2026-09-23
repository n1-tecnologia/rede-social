import type { ReactNode } from 'react';
import { FEED_URL_PATTERN, trimMatchedUrl } from '../contracts/index';

/**
 * THE auto-linker for every piece of member-authored text this module renders — the post caption
 * (D-54) and the comment body (04-07), one implementation.
 *
 * It was extracted out of `PostCaption` the moment a SECOND surface needed it. A copy would be the
 * exact drift the threat register warns about (T-04-43): the two would eventually disagree about
 * which schemes may become an `href` or which link relationship attributes go on it, and the
 * weaker of the two would be the one a member can post into. There is one matcher, one `href`
 * rule and one `rel` here, and both surfaces call it.
 *
 * THREE RULES THIS FILE EXISTS TO HOLD:
 *
 * 1. **Never an HTML-injection sink.** No raw-HTML escape hatch is used here, and none may appear
 *    anywhere under `packages/modules/feed/ui/**` (T-04-04, T-04-43). Captions and comment bodies
 *    are stored as plain text and React escapes them; text containing `<script>` renders as the
 *    characters the member typed.
 * 2. **Links are built at RENDER time, from a matcher that only accepts `http:`/`https:`.** The
 *    `href` is a substring that already matched `https?://…`, so a `javascript:` or `data:` URL can
 *    never reach it — it simply is not a link and renders as text. Every link carries
 *    `rel="noopener noreferrer nofollow"` and `target="_blank"`.
 * 3. **The matcher is imported from the module's contracts, not declared here** (MEDIA-04). The
 *    create path picks the URL it unfurls with that exact function; two copies would produce the
 *    two shapes nobody can explain — a preview card under a URL the text did not turn blue, or a
 *    blue URL the unfurler never saw.
 */

/**
 * Splits `text` into plain runs and `<a>` elements. Keys carry the match offset, so they are stable
 * across re-renders and no array index is used as a key.
 */
export function linkify(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(FEED_URL_PATTERN)) {
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
        className="text-brand underline-offset-2 hover:underline"
      >
        {url}
      </a>,
    );
    cursor = start + url.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
