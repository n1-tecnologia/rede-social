'use client';

import { PullToRefresh } from '@rede-social/ui';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Pull-to-refresh for the server-rendered detail page (UI-D-216): a pull re-runs the RSC render, so
 * the counts, the viewer's state and the phase come back from the API. Mobile only (the primitive's
 * own media query).
 */
export function EventRefresh({ children }: { children: ReactNode }) {
  const router = useRouter();
  return <PullToRefresh onRefresh={() => router.refresh()}>{children}</PullToRefresh>;
}
