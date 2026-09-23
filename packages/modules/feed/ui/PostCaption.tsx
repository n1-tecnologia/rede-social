'use client';

import { useState } from 'react';
import { linkify } from './linkify';

/**
 * The caption — `[proto]` `feed/PostCaption.tsx` minus the leading username span, plus the "… mais"
 * truncation that is this component's own behaviour.
 *
 * D-54's "plain text with clickable links" is implemented by the SHARED `linkify` — the same one
 * `CommentItem` renders a comment body with. It owns all three rules: no HTML-injection sink, an
 * `href` that can only ever be a matched `http(s)` substring carrying
 * `rel="noopener noreferrer nofollow"`, and newlines preserved by `whitespace-pre-wrap` here so the
 * member's own line breaks survive. Keeping it in one place is what stops the caption and the
 * comment from drifting apart on any of the three (T-04-43).
 */
export type PostCaptionProps = {
  caption: string;
  /** Characters shown before the "… mais" toggle. */
  truncateAt: number;
  /** "… mais" — the toggle's label (pt-BR lives in the web catalog, never here). */
  moreLabel: string;
};

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
