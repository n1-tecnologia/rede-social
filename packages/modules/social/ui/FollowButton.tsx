import { Button } from '@rede-social/ui';

/**
 * The strings the host passes in (the module ships no language, MOD-02). `ariaFollow` and
 * `ariaFollowing` are the accessible names; each CONTAINS its visible word (WCAG 2.5.3, label in
 * name), so a voice-control user who says what they see hits the button.
 */
export interface FollowButtonLabels {
  follow: string;
  following: string;
  ariaFollow: string;
  ariaFollowing: string;
}

export interface FollowButtonProps {
  /** The caller's state toward this person. */
  following: boolean;
  /** An action is in flight: the shipped `loading` look (spinner, `aria-busy`, disabled), label kept. */
  pending?: boolean;
  /** `md` on the profile and the locked screen, `sm` on a list row (a fixed `w-24`). */
  size?: 'md' | 'sm';
  fullWidth?: boolean;
  /** Merged last, so a host caps the width (`md:max-w-[400px]` on the profile). */
  className?: string;
  labels: FollowButtonLabels;
  onToggle: () => void;
}

/**
 * The Seguir / Seguindo button (09-10, UI-D-498, D-470), ported from the prototype's
 * `components/profile/FollowButton.tsx` onto the shipped `Button`.
 *
 * **Props only.** No words, no route, no fetch and no state: the optimistic flip, the server action
 * and the error toast live in the host (`apps/web/components/social/FollowControl.tsx`), so this
 * module stays reusable in another project (MOD-02).
 *
 * *Not following* is the brand button, *following* the outline one (never the danger colour: leaving
 * is not destructive). There is no hover swap to "Deixar de seguir" and no confirmation. The `sm` row
 * button is a fixed `w-24 shrink-0` so every row aligns whatever the label, and it carries the
 * transparent 44px hit area (`hitArea`) the shipped `sm` needs.
 */
export function FollowButton({
  following,
  pending = false,
  size = 'md',
  fullWidth = false,
  className,
  labels,
  onToggle,
}: FollowButtonProps) {
  const row = size === 'sm';

  return (
    <Button
      variant={following ? 'outline' : 'brand'}
      size={size}
      hitArea={row}
      fullWidth={fullWidth}
      loading={pending}
      aria-label={following ? labels.ariaFollowing : labels.ariaFollow}
      className={row ? ['w-24 shrink-0', className].filter(Boolean).join(' ') : className}
      onClick={onToggle}
    >
      {following ? labels.following : labels.follow}
    </Button>
  );
}
