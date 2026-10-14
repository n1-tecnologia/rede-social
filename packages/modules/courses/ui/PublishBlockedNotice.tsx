import { CircleAlert } from 'lucide-react';
import type { Ref } from 'react';

/**
 * The publish-blocked notice of the course page (08.3-08, UI-D-394, D-413, COURSE-03): a warning
 * card — `bg-warning/10`, `CircleAlert` 20 in `text-warning`, `role="status"` (it is informative,
 * not the refusal of an input, UI-D-407) — with the host's sentence ("Não é possível publicar: 2
 * aulas ainda processam o vídeo.") and the blocking lessons as links to their forms: at most five,
 * then the host's "e mais {n}" link to the curriculum (E05 overflow). It sits ABOVE the disabled
 * "Publicar curso": the reason before the tap. `tabIndex={-1}` so the host can focus it when the
 * server's `409 video_not_ready` re-renders it from its own lesson ids (server truth wins).
 *
 * Presentational and props-only (PWA-03, MOD-02): it ships no words, resolves no route and renders
 * every title as React text (T-08.3-25).
 */
export const PUBLISH_BLOCKED_MAX_LINKS = 5;

export interface PublishBlockedLink {
  href: string;
  label: string;
}

export interface PublishBlockedNoticeProps {
  sentence: string;
  /** The blocking lessons in the curriculum's order; the first five render, the rest is `moreLabel`. */
  links: readonly PublishBlockedLink[];
  /** Where "e mais {n}" goes (the curriculum). Rendered only with `moreLabel` and more than five links. */
  moreHref?: string;
  moreLabel?: string;
  ref?: Ref<HTMLDivElement>;
  id?: string;
}

const LINK =
  'font-bold text-text underline decoration-warning/60 underline-offset-2 hover:decoration-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-sm';

export function PublishBlockedNotice({
  sentence,
  links,
  moreHref,
  moreLabel,
  ref,
  id,
}: PublishBlockedNoticeProps) {
  const shown = links.slice(0, PUBLISH_BLOCKED_MAX_LINKS);
  const more = links.length > PUBLISH_BLOCKED_MAX_LINKS && moreHref && moreLabel;

  return (
    <div
      ref={ref}
      id={id}
      role="status"
      tabIndex={-1}
      data-testid="publish-blocked"
      className="flex gap-3 rounded-xl bg-warning/10 p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-warning"
    >
      <CircleAlert aria-hidden size={20} className="mt-0.5 shrink-0 text-warning" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p data-testid="publish-blocked-sentence" className="text-sm font-normal text-text">
          {sentence}
        </p>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {shown.map((link) => (
            <a
              key={link.href}
              href={link.href}
              data-testid="publish-blocked-link"
              className={`${LINK} break-words`}
            >
              {link.label}
            </a>
          ))}
          {more ? (
            <a href={moreHref} data-testid="publish-blocked-more" className={LINK}>
              {moreLabel}
            </a>
          ) : null}
        </p>
      </div>
    </div>
  );
}
