import { Card } from '@rede-social/ui';
import type { ReactNode } from 'react';

/**
 * The strings and nodes the host passes in (the module ships no language and knows no route, MOD-02).
 * The heading and the body are already formatted; the avatar node and the action node are built by
 * the host (the avatar's link to the profile and its lock disc, the Seguir control).
 */
export interface LockedPostProps {
  heading: string;
  body: string;
  avatar: ReactNode;
  action: ReactNode;
}

/**
 * The "Siga para ver" card (09-11, UI-D-499, D-469): what a stranger meets at a shared link to a
 * followers-only member post. One centred column - the author's avatar, the heading, the body and the
 * one action - and **nothing else**: no caption, no media, no counts, no comments, no placeholders and
 * no skeleton cards. The server sends only the author's name and photo (D-469), so there is nothing
 * else it could draw.
 *
 * **Props only.** No words, no route, no fetch and no state: the follow, the refresh and the focus
 * live in `apps/web/components/social/LockedPostScreen.tsx`. The heading clamps to two lines and
 * breaks long words, so a long display name never scrolls the page sideways at 320px.
 */
export function LockedPost({ heading, body, avatar, action }: LockedPostProps) {
  return (
    <Card className="flex flex-col items-center gap-4 p-6 text-center">
      {avatar}
      <h2 className="line-clamp-2 break-words text-base font-bold leading-tight text-text">
        {heading}
      </h2>
      <p className="max-w-[260px] text-sm text-text-secondary">{body}</p>
      {action}
    </Card>
  );
}
