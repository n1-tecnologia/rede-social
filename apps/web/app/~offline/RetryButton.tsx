'use client';

import { Button } from '@tria/ui';

/**
 * "Tentar novamente" on the offline page (E09/error): a plain reload — while the device is still
 * offline the service worker answers with the same fallback page. The label arrives as a prop
 * (catalog rule, PWA-03).
 */
export function RetryButton({ label }: { label: string }) {
  return (
    <Button variant="outline" onClick={() => window.location.reload()}>
      {label}
    </Button>
  );
}
