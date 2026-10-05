'use client';

import { useCallback, useEffect, useState } from 'react';
import { PROFILE_NUDGE_DELAY_MS } from '@/lib/profile-nudge';

export interface PreviewNudge {
  /** The popup is up over the phone's Início. */
  open: boolean;
  /** "Completar agora" or "Mais tarde": ends the popup for the preview's visit. */
  answer: () => void;
  /** The phone login's "Entrar" (or "Criar conta"): a sign-in, so a visit with the popup due. */
  signIn: () => void;
}

/**
 * The wizard phone's visit of the "Complete seu perfil" popup (`TenantAppPreview`), on the app's
 * rules (`ProfileNudgeOnArrival`, `RearmProfileNudge`). Due when the device opens, as when the app
 * starts; up once Início has shown for the app's settle time (`PROFILE_NUDGE_DELAY_MS`), every new
 * arrival waiting again; ended by either answer; due again only after `signIn`, as only a SUBMITTED
 * sign-in re-arms it in the app. The login screen merely shown, by the phone's "Sair" or by the
 * panel's screen picker, re-arms nothing.
 *
 * Leaving Início while the popup is up answers it too ("Mais tarde"), for the keyboard. Its scrim
 * covers the whole phone, so nothing in the phone can change the screen then: only the panel's
 * screen picker can, and that picker is the keyboard's one way through the device (the phone is
 * out of the tab order and the preview's popup takes no focus, `ProfileNudgeDialog preview`).
 * Without this a keyboard could never get the popup off the phone's Início.
 */
export function usePreviewNudge(onHome: boolean): PreviewNudge {
  const [answered, setAnswered] = useState(false);
  const [risen, setRisen] = useState(false);
  const due = onHome && !answered;

  useEffect(() => {
    if (!due) return;
    let up = false;
    const timer = window.setTimeout(() => {
      up = true;
      setRisen(true);
    }, PROFILE_NUDGE_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      setRisen(false);
      // No longer due while it was up: an answer, or Início left under it (the picker).
      if (up) setAnswered(true);
    };
  }, [due]);

  const answer = useCallback(() => setAnswered(true), []);
  const signIn = useCallback(() => setAnswered(false), []);
  return { open: due && risen, answer, signIn };
}
