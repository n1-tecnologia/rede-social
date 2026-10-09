import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { Avatar } from '@rede-social/ui';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { MediaImage } from '@/components/media/MediaImage';
import { profileRowSnippet } from '@/lib/profile-instagram';

export interface MemberRowProps {
  membershipId: string;
  displayName: string;
  /** The photo asset, or `null` — the neutral `Avatar` icon is the whole fallback (R-09). */
  avatarAssetId: string | null;
  /**
   * The bio as stored; only its visible text's FIRST LINE is shown, truncated (UI-D-02), or the
   * `@handle` when the bio holds nothing but the Instagram line (`profileRowSnippet`).
   */
  bio: string | null;
}

/**
 * One directory row, ported from `reference/frontend-design/components/profile/UserListItem.tsx`
 * MINUS `FollowButton` (PROTOTYPE 11) and minus the `@username` line, which has no model behind it
 * in V1. The slot the handle used to occupy carries the bio's first line instead (UI-D-02) — the
 * only scanning signal left once the handle, the follow button and the counts are gone. Since
 * 2026-10-09 a bio may close with the member's Instagram line (`lib/profile-instagram.ts`): the row
 * never prints that line raw, and shows the `@handle` only when there is no text to show.
 *
 * The WHOLE row is ONE `<Link>` (the prototype split it into two links plus a button): a single
 * focusable target, so the photo inside it is not separately reachable by keyboard
 * (UI-SPEC Motion and Accessibility).
 *
 * With no bio the second span is not rendered AT ALL and the row collapses to one line while keeping
 * `min-h-14` — no placeholder text is invented (UI-SPEC E4/partial). Both spans `truncate`, so a long
 * name or bio ellipsises inside the row instead of wrapping (E4/overflow), and nothing here
 * highlights a search match: the directory makes no such promise (R-10).
 *
 * Name and bio are authored by ANOTHER member and are rendered as plain React text — React escapes
 * them, and there is no `dangerouslySetInnerHTML` and no Markdown renderer anywhere on this path
 * (T-03-31).
 */
export function MemberRow({ membershipId, displayName, avatarAssetId, bio }: MemberRowProps) {
  const snippet = profileRowSnippet(bio);

  return (
    <Link
      href={`/membros/${membershipId}`}
      className="flex min-h-14 items-center gap-3 px-4 py-3 text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand md:hover:bg-card-hover"
    >
      {avatarAssetId ? (
        <MediaImage
          assetId={avatarAssetId}
          widths={PURPOSE_WIDTHS.avatar}
          baseWidth={128}
          alt={displayName}
          sizes="40px"
          ratio="aspect-square"
          className="h-10 w-10 shrink-0 rounded-full"
          fallback={<Avatar size="md" alt={displayName} />}
        />
      ) : (
        <Avatar size="md" alt={displayName} />
      )}

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-bold text-text">{displayName}</span>
        {snippet ? <span className="truncate text-xs text-text-tertiary">{snippet}</span> : null}
      </span>

      <ChevronRight aria-hidden size={18} className="shrink-0 text-text-tertiary" />
    </Link>
  );
}
