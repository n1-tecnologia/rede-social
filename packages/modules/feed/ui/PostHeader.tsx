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
 *
 * **D-71 / UI-D-36 — the "em {Comunidade}" segment (05-03).** The merged feed mixes two sources
 * into one chronological list, so a community post that did not say where it came from would
 * misrepresent its origin to the member reading it — and the segment is also the only discovery
 * path from the feed into a community. Three rules the prop shape encodes:
 *
 *  - **the module ships no words and builds no route.** The whole visible string arrives
 *    interpolated as `community.label` and the href arrives as `community.href`; nothing in this
 *    file knows the word "em", the route table or which tenant it is rendering for;
 *  - **it is deliberately NOT brand.** The author's own display-name link above is a non-accent
 *    link by Phase 2's explicit rule, and a brand-coloured community link in the same card would
 *    claim the community outranks the person who wrote the post;
 *  - **absent beats blank.** `community: null` renders the `<time>` alone — no middot, no empty
 *    node — which is UI-D-21's meta-row rule restated, and `suppressCommunity` does the same on the
 *    community's own page, where the segment would only restate the page the reader is standing on.
 */
export type PostHeaderProps = {
  displayName: string;
  /** `/membros/{membershipId}` — built by the host, never assembled inside the module. */
  profileHref: string;
  avatarUrl: string | null;
  createdAtIso: string;
  createdAtRelative: string;
  createdAtAbsolute: string;
  /**
   * D-71. `null` (or omitted) is the tenant-wide post and renders nothing at all.
   *
   * `label` is the ALREADY-INTERPOLATED visible string ("em {community}" resolved by the host's
   * catalog) and `ariaLabel` is its accessible name ("Ver a comunidade {community}"); `href` is
   * `/comunidades/{id}`, composed by the host from its own route table (MOD-02).
   */
  community?: { label: string; href: string; ariaLabel: string } | null;
  /** UI-D-36: the community's OWN page passes this — the label would restate the page. */
  suppressCommunity?: boolean;
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
  community = null,
  suppressCommunity = false,
  onMore,
  moreLabel,
}: PostHeaderProps) {
  const segment = suppressCommunity ? null : community;
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
          {/* UI-D-36's overflow rule, expressed as three flex children rather than as a max-width:
              the `<time>` is `shrink-0` so it NEVER truncates, the middot is `shrink-0` so it can
              never be the thing that disappears, and the community link is the only `min-w-0
              truncate` child — so at any name length the row stays one line and the part that gives
              way is the part that can afford to. */}
          <div className="flex min-w-0 items-center gap-1">
            <time
              dateTime={createdAtIso}
              title={createdAtAbsolute}
              className="shrink-0 text-xs font-normal text-text-tertiary"
            >
              {createdAtRelative}
            </time>
            {segment ? (
              <>
                <span
                  aria-hidden
                  data-post-community-sep
                  className="shrink-0 text-xs font-normal text-text-tertiary"
                >
                  ·
                </span>
                <a
                  href={segment.href}
                  aria-label={segment.ariaLabel}
                  data-post-community
                  className="min-w-0 truncate text-xs font-bold text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  {segment.label}
                </a>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {onMore && moreLabel ? (
        <IconButton icon={MoreHorizontal} size={20} label={moreLabel} onClick={onMore} />
      ) : null}
    </div>
  );
}
