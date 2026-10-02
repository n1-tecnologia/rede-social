import type { ModerationAction } from '@rede-social/contracts/moderation';
import { Ban, LockOpen, type LucideIcon, Trash2, UserCog } from 'lucide-react';
import type { ModerationLogRowView } from '@/lib/moderation-view';

/**
 * One row of the moderation log (UI-D-278, D-337) — READ-ONLY: not a link, no actions, no menu. The
 * admin acts in context (the comment) or in Membros, and reads here (UI-D-277).
 *
 * COPY-FREE: every string arrives already resolved in the view (`toModerationLogView`), so the row
 * renders the sentence PARTS it is given — the actor and the target as 700 spans — and never builds
 * markup from a template. React text only, no raw-HTML path (T-08-09): the excerpt is member content.
 *
 * The excerpt is the evidence of what was removed, so it is shown WHOLE on a tertiary ground and never
 * clamped; `whitespace-pre-line` keeps the author's line breaks and `[overflow-wrap:anywhere]` keeps a
 * long unbroken word inside the column at 320px.
 */
const GLYPHS: Record<ModerationAction, LucideIcon> = {
  comment_removed: Trash2,
  member_blocked: Ban,
  member_unblocked: LockOpen,
  role_changed: UserCog,
};

export function ModerationLogRow({ view }: { view: ModerationLogRowView }) {
  const Glyph = GLYPHS[view.action];
  return (
    <li
      data-moderation-log-row={view.action}
      className="flex min-h-16 items-start gap-3 border-b border-divider px-4 py-3 last:border-0"
    >
      <span
        aria-hidden
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-bg-tertiary text-text-secondary"
      >
        <Glyph size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-normal text-text-secondary [overflow-wrap:anywhere]">
          {view.sentence.map((part, index) =>
            part.strong ? (
              // The parts are positional and never reordered, so the index is a stable key.
              // biome-ignore lint/suspicious/noArrayIndexKey: positional sentence parts
              <span key={index} className="font-bold text-text">
                {part.text}
              </span>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional sentence parts
              <span key={index}>{part.text}</span>
            ),
          )}
        </p>
        {view.context ? (
          <p className="mt-1 text-xs font-normal text-text-tertiary">{view.context}</p>
        ) : null}
        {view.excerpt ? (
          <p
            data-moderation-log-excerpt
            className="mt-2 rounded-xl bg-bg-tertiary px-3 py-2 text-sm font-normal whitespace-pre-line text-text [overflow-wrap:anywhere]"
          >
            {view.excerpt}
          </p>
        ) : null}
        {view.reason ? (
          <p className="mt-2 text-xs font-normal whitespace-pre-line text-text-secondary [overflow-wrap:anywhere]">
            {view.reason}
          </p>
        ) : null}
        <p className="mt-1 text-xs font-normal text-text-tertiary tabular-nums">
          <time dateTime={view.iso}>{view.time}</time>
        </p>
      </div>
    </li>
  );
}
