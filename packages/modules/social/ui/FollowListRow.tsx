import type { ReactNode } from 'react';

export interface FollowListRowProps {
  /** The person's profile. The whole link slot (photo, name, first line) goes there. */
  href: string;
  /** The photo, already built by the host (a `MediaImage` or the neutral `Avatar`). */
  avatar: ReactNode;
  name: string;
  /** The first line of the bio, or `null`/absent: the row then collapses to one line. */
  snippet?: string | null;
  /** The trailing slot: the follow button, a "Você" label or an empty slot of the same width. */
  action: ReactNode;
}

/**
 * One person in a list (09-10, UI-D-502, UI-D-503, D-470), ported from the prototype's
 * `components/profile/UserListItem.tsx` over `MemberRow`'s anatomy: a LINK slot and a SIBLING action
 * slot, so a tap on the person opens the profile and a tap on the button follows, and neither
 * contains the other (a button inside an anchor is invalid and breaks focus).
 *
 * **Link first, action second** in the DOM (EP-44), so keyboard focus meets the person before the
 * action. The geometry is `MemberRow`'s shipped `flex min-h-14 items-center gap-3 px-4 py-3` (the
 * scoped 12px exception of the UI-SPEC) so the loading skeleton and the rows do not shift when the
 * list resolves. Name and snippet `truncate` inside the link slot (`min-w-0 flex-1`), and the action
 * slot is `shrink-0`, so a long name never squeezes the button (E07 overflow and long-text).
 *
 * Props only (MOD-02): no words, no route knowledge beyond the `href` it is given, no fetch. The name
 * and the snippet are authored by ANOTHER member and render as plain React text (T-03-31).
 */
export function FollowListRow({ href, avatar, name, snippet, action }: FollowListRowProps) {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-3">
      <a
        href={href}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {avatar}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-bold text-text">{name}</span>
          {snippet ? <span className="truncate text-xs text-text-tertiary">{snippet}</span> : null}
        </span>
      </a>
      <div className="shrink-0">{action}</div>
    </div>
  );
}
