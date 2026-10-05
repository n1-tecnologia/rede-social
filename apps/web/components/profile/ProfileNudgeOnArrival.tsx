'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { endProfileNudge, PROFILE_NUDGE_DELAY_MS, profileNudgeDue } from '@/lib/profile-nudge';
import { ProfileNudgeDialog } from './ProfileNudgeDialog';

export interface ProfileNudgeOnArrivalProps {
  /** The member's own membership: what the visit marker records once the popup is answered. */
  membershipId: string;
}

/**
 * Raises the "Complete seu perfil" popup when a member ARRIVES at Início, the app's entry
 * (`/entrar` lands there), as the reference app does after a login (`socialroberth-completo`,
 * `components/profile/ConviteDeEntrada.tsx`). Início mounts it only while the server's `needsNudge`
 * holds (R-13), so a member who dismissed the old card never sees the popup.
 *
 * The page settles for 500 ms, then the popup rises unless this visit already answered it
 * (`lib/profile-nudge.ts`). Either answer, or Escape, ends it for the visit: "Completar agora"
 * opens `/perfil/editar`, "Mais tarde" only closes. Neither writes anything on the server any more
 * (`dismissNudgeAction` is no longer called), so the popup rises again on the next sign-in while
 * the profile is still incomplete; a reload or a return to Início in the same visit keeps it
 * closed. Storage that cannot be read means no popup at all.
 *
 * Renders nothing on the server and nothing until the timer fires, so hydration has nothing to
 * disagree with; leaving Início before then cancels the timer.
 */
export function ProfileNudgeOnArrival({ membershipId }: ProfileNudgeOnArrivalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!profileNudgeDue(membershipId)) return;
    const timer = window.setTimeout(() => setOpen(true), PROFILE_NUDGE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [membershipId]);

  const complete = useCallback(() => {
    endProfileNudge(membershipId);
    setOpen(false);
    router.push('/perfil/editar');
  }, [membershipId, router]);

  const later = useCallback(() => {
    endProfileNudge(membershipId);
    setOpen(false);
  }, [membershipId]);

  return <ProfileNudgeDialog open={open} onComplete={complete} onLater={later} />;
}
