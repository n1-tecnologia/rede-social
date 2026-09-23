import { Avatar, IconButton } from '@tria/ui';
import { MoreHorizontal } from 'lucide-react';

/**
 * The card's author row (`[proto]` `feed/PostHeader.tsx` minus `@username`, `VerifiedBadge`,
 * `authorGender` and `location`).
 *
 * **UI-D-14 — no clock call in render.** Both timestamp strings arrive as props, formatted on the
 * SERVER: `relative` is what the reader sees, `absolute` is the `title`, and `iso` is the machine
 * value. Reading a clock here would be a hydration mismatch waiting for the first slow render.
 *
 * **D-52 — the post is attributed to the PERSON**, so the display name links to their profile. A
 * plain `<a>` rather than `next/link`: a module package must not depend on the web framework (MOD-02),
 * and the host app is free to intercept the navigation.
 *
 * The trailing 44x44 overflow control renders ONLY when the host passes a handler and its label:
 * 04-09 owns the menu behind it, and a control that opens nothing would be a promise the card
 * cannot keep.
 */
export type PostHeaderProps = {
  displayName: string;
  /** `/membros/{membershipId}` — built by the host, never assembled inside the module. */
  profileHref: string;
  avatarUrl: string | null;
  createdAtIso: string;
  createdAtRelative: string;
  createdAtAbsolute: string;
  /** Opens the post's overflow menu (04-09). Absent, the control is not rendered at all. */
  onMore?: () => void;
  /** Accessible name of the overflow control; required alongside `onMore`. */
  moreLabel?: string;
};

export function PostHeader({
  displayName,
  profileHref,
  avatarUrl,
  createdAtIso,
  createdAtRelative,
  createdAtAbsolute,
  onMore,
  moreLabel,
}: PostHeaderProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {/* The photo is NOT a second link to the same place: one target per destination keeps the
            card's tab order at one stop and stops a screen reader announcing the author twice
            (`[proto]` does the same). The display name below is the link. */}
        <Avatar src={avatarUrl} alt={displayName} size="sm" />

        <div className="min-w-0">
          <a
            href={profileHref}
            className="block truncate text-sm font-bold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {displayName}
          </a>
          <time
            dateTime={createdAtIso}
            title={createdAtAbsolute}
            className="block truncate text-xs font-normal text-text-tertiary"
          >
            {createdAtRelative}
          </time>
        </div>
      </div>

      {onMore && moreLabel ? (
        <IconButton icon={MoreHorizontal} size={20} label={moreLabel} onClick={onMore} />
      ) : null}
    </div>
  );
}
