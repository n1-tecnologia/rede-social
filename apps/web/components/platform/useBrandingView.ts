'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { getBrandingStatusAction } from '@/app/(platform)/plataforma/tenants/[id]/marca/actions';
import type { BrandingView } from '@/lib/branding-view';
import type { IconsStatus } from './DerivedIcons';

/** Icon-derivation poll: every 3 s, at most 20 times (≈ 60 s), then the honest "slow" copy (D-28). */
const POLL_MS = 3000;
const pollExhausted = (attempts: number) => attempts >= 20;

/**
 * The branding view a Marca screen shows (the tenant tab's `BrandingForm` and the wizard's Marca
 * step), kept in step with the worker's icon derivation: while the derived set is not ready it polls
 * `status` every 3 s (at most 20 times), drops a stale answer (older `iconVersion`, T-02-117) and
 * refreshes the route once the set is ready. `adopt` takes a fresh view from an upload, a removal or
 * a save and restarts the poll.
 */
export function useBrandingView(
  tenantId: string,
  initialView: BrandingView,
  status: typeof getBrandingStatusAction,
) {
  const router = useRouter();
  const [view, setView] = useState(initialView);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (!view.hasSource || view.iconsReady || pollExhausted(attempts)) return;
    const id = setTimeout(async () => {
      const result = await status(tenantId);
      if (result.ok && result.view.iconVersion >= view.iconVersion) {
        setView(result.view);
        if (result.view.iconsReady) router.refresh();
      }
      setAttempts((n) => n + 1);
    }, POLL_MS);
    return () => clearTimeout(id);
  }, [view.hasSource, view.iconsReady, view.iconVersion, attempts, tenantId, status, router]);

  const adopt = (next: BrandingView) => {
    setView(next);
    setAttempts(0);
  };

  const iconStatus: IconsStatus = view.iconsReady
    ? 'ready'
    : pollExhausted(attempts)
      ? 'slow'
      : 'generating';

  return { view, adopt, iconStatus };
}
