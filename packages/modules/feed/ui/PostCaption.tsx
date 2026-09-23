'use client';

import { type ReactNode, useState } from 'react';
import { FEED_URL_PATTERN, trimMatchedUrl } from '../contracts/index';

/**
 * The caption (`[proto]` `feed/PostCaption.tsx` minus the leading username span), and the single
 * place D-54's "plain text with clickable links" is implemented.
 *
 * THREE RULES THIS FILE EXISTS TO HOLD:
 *
 * 1. **Never an HTML-injection sink.** No raw-HTML escape hatch is used here, and none may appear
 *    anywhere under `packages/modules/feed/ui/**` (T-04-04). The caption is stored as
 *    plain text and React escapes it; a caption containing `<script>` renders as the characters a
 *    member typed.
 * 2. **Links are built at RENDER time, from a matcher that only accepts `http:`/`https:`.** The
 *    `href` is a substring that already matched `https?://…`, so a `javascript:` or `data:` URL can
 *    never reach it — it simply is not a link and renders as text. Every link carries
 *    `rel="noopener noreferrer nofollow"` and `target="_blank"`.
 * 3. **Newlines survive** (`whitespace-pre-wrap`): the member typed the shape of the announcement,
 *    and collapsing it would silently rewrite their post.
 */
export type PostCaptionProps = {
  caption: string;
  /** Characters shown before the "… mais" toggle. */
  truncateAt: number;
  /** "… mais" — the toggle's label (pt-BR lives in the web catalog, never here). */
  moreLabel: string;
};

/**
 * THE matcher, imported from the module's contracts rather than declared here (MEDIA-04).
 *
 * The create path picks the URL it unfurls with this exact function. Two copies would drift on the
 * first change and produce the two shapes nobody can explain: a preview card under a URL the caption
 * did not turn blue, or a blue URL the unfurler never saw. It is still deliberately conservative —
 * a run of non-space characters after `http://` or `https://`, with trailing sentence punctuation
 * pushed back into the text so "veja https://exemplo.com." links the URL and not the full stop.
 */

/**
 * Splits `text` into plain runs and `<a>` elements. Keys carry the match offset, so they are stable
 * across re-renders and no array index is used as a key.
 */
function linkify(text: string): ReactNode[] {
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

export function PostCaption({ caption, truncateAt, moreLabel }: PostCaptionProps) {
  const [expanded, setExpanded] = useState(false);
  const truncated = !expanded && caption.length > truncateAt;
  // Truncate FIRST, then link: a URL cut in half must not become a clickable half-URL.
  const shown = truncated ? caption.slice(0, truncateAt) : caption;

  return (
    <p className="whitespace-pre-wrap px-4 pt-3 text-base font-normal leading-relaxed text-text">
      {linkify(shown)}
      {truncated ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="ml-0.5 text-base font-normal text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {moreLabel}
        </button>
      ) : null}
    </p>
  );
}
