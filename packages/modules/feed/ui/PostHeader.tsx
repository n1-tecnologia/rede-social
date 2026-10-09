import { AdminBadge, type AdminIconId, Avatar, IconButton } from '@rede-social/ui';
import { MoreHorizontal } from 'lucide-react';

/**
 * The card's author row (`[proto]` `feed/PostHeader.tsx` minus `authorGender` and `location`). The
 * `[proto]`'s `VerifiedBadge` came back on 2026-10-06 as the administrator's mark (`adminLabel` and
 * `adminIcon`, decided by the host): the crown, or the icon the administrator picked, in the
 * tenant's secondary colour.
 *
 * **The `[proto]`'s `@username` came back on 2026-10-09 as a host-composed line** (`handle`): the
 * author's Instagram, between the name and the time, a link that opens Instagram in a new tab. The
 * module ships no word and builds no address: the visible `@handle`, the href and the accessible name
 * all arrive finished, and an author without one renders no line at all.
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
/**
 * The meta-row separator glyph. A constant rather than JSX text because the formatter puts this
 * span's child on its own line, and Biome's `noJsxLiterals` (08-11) compares the raw text, so the
 * allow-listed "·" would arrive wrapped in whitespace and fail. Typography, not language: it is the
 * same in every locale, which is why it does not live in the catalog.
 */
const MIDDOT = '·';

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
  /**
   * 2026-10-06: the author is an administrator, and this is the mark's accessible name
   * ("Administrador"); the mark sits after the name. The HOST decides it; absent, no mark.
   */
  adminLabel?: string | null;
  /** The administrator's picked icon (`AdminBadge`); absent draws the crown. */
  adminIcon?: AdminIconId | null;
  /**
   * 2026-10-09: the author's Instagram line. `label` is the visible `@handle`, `href` the profile's
   * address and `ariaLabel` the link's accessible name ("Ver @handle no Instagram"), all composed
   * by the host. `null` (or omitted) renders no line.
   */
  handle?: { label: string; href: string; ariaLabel: string } | null;
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
  adminLabel = null,
  adminIcon = null,
  handle = null,
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
          <div className="flex min-w-0 items-center gap-1.5">
            <a
              href={profileHref}
              className="block min-w-0 truncate text-sm font-bold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              {displayName}
            </a>
            {adminLabel ? <AdminBadge label={adminLabel} icon={adminIcon} size={16} /> : null}
          </div>
          {/* The author's Instagram (2026-10-09): its own line, as wide as the handle (`w-fit`, so
              the empty space beside it opens nothing) and truncating inside the column. */}
          {handle ? (
            <a
              href={handle.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={handle.ariaLabel}
              data-post-handle
              className="block w-fit max-w-full truncate text-xs font-normal text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              {handle.label}
            </a>
          ) : null}
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
                  {MIDDOT}
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
