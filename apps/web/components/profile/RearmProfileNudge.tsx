'use client';

import { useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { rearmProfileNudge } from '@/lib/profile-nudge';

/**
 * Makes the "Complete seu perfil" popup due again (`lib/profile-nudge.ts`) when a member SIGNS IN.
 * It sits INSIDE the entry forms of `/entrar`, `/cadastro` and `/aceitar-convite` and re-arms the
 * moment the form's submission starts (`useFormStatus`), so every sign-in, sign-up or accepted
 * invite begins a visit in which the popup rises on Início while the profile is still incomplete:
 * the reference app asks after every login (`socialroberth-completo`, `pedirConvitePerfil`).
 *
 * Never on mount: an entry page that is only SHOWN is not a sign-in. The sign-in's redirect is a
 * history push and `proxy.ts` lets a signed-in member see `/entrar`, so Back from Início (the
 * browser's button, Android's gesture) lands there; re-arming on view would raise the popup again
 * on the way Forward, after the member already answered it in this visit. A submission that fails
 * (a wrong password) re-arms too: a sign-in was attempted, and the next arrival only asks again.
 *
 * Renders nothing, and never fires outside a `<form>`. Storage that cannot be reached is ignored.
 */
export function RearmProfileNudge() {
  const { pending } = useFormStatus();
  useEffect(() => {
    if (pending) rearmProfileNudge();
  }, [pending]);
  return null;
}
