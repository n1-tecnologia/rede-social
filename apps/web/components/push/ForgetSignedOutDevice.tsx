'use client';

import { useEffect } from 'react';
import { disablePush, pushRegistrationWithin } from '@/lib/push';

/**
 * 07 review C-WR-06: the signed-out entry surfaces (`/entrar` with no session, `/acesso-suspenso`)
 * forget this device's push subscription and clear the app icon badge. "Sair" already does both
 * (`BeforeLogout`), but a session can also end without it: an expired or revoked refresh token, a
 * global sign-out from another device, cleared cookies. The browser would then keep showing the
 * previous member's notification titles and bodies on a device where nobody is signed in.
 *
 * `unsubscribe()` is what stops delivery; the parallel DELETE answers 401 without a session, and the
 * server row goes at the next send (the push service answers 410 for an unsubscribed endpoint). Every
 * step is bounded and swallowed: this never blocks or breaks the page. Renders nothing.
 */
export function ForgetSignedOutDevice() {
  useEffect(() => {
    void pushRegistrationWithin()
      .then((registration) => disablePush(registration))
      .catch(() => {});
    const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
    void nav.clearAppBadge?.().catch(() => {});
  }, []);
  return null;
}
