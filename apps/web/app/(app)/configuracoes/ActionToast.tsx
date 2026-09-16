'use client';

import { type ToastTone, useToast } from '@tria/ui';
import { useEffect } from 'react';

/**
 * Fires one toast on mount (the `ToastProvider` is mounted by `AppShell`). Used by server pages that
 * land with a `?erro=…` query after a failed server action — e.g. a rejected sign-out (E05/error).
 */
export function ActionToast({ message, tone = 'error' }: { message: string; tone?: ToastTone }) {
  const { show } = useToast();
  // biome-ignore lint/correctness/useExhaustiveDependencies: fire once per mount with the message the page landed with
  useEffect(() => {
    show({ tone, message });
  }, []);
  return null;
}
