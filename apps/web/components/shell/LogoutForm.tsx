'use client';

import { useLogoutSubmit } from '@rede-social/core/ui';
import { type ReactNode, useCallback } from 'react';
import { disablePush, pushRegistrationWithin } from '@/lib/push';

/**
 * The Configurações "Sair" form (07-07, T-07-45). Before the sign-out action runs it forgets this
 * device's push subscription (unsubscribe + DELETE through the BFF, while the session still exists),
 * so the next person on a shared browser never receives the previous member's pushes. Everything is
 * bounded to 2 s (`useLogoutSubmit`), so a dead network never blocks logging out (T-07-48). On a
 * device with no subscription it costs nothing.
 */
export function LogoutForm({
  action,
  className,
  children,
}: {
  action: () => Promise<void>;
  className?: string;
  children: ReactNode;
}) {
  const forgetDevice = useCallback(async () => {
    await disablePush(await pushRegistrationWithin());
  }, []);
  const onSubmit = useLogoutSubmit(forgetDevice);
  return (
    <form action={action} onSubmit={onSubmit} className={className} data-logout-form>
      {children}
    </form>
  );
}
