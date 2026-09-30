'use client';

import { Button, Card, cn, IconButton } from '@rede-social/ui';
import { Bell, BellRing, X } from 'lucide-react';

export interface SoftAskCardProps {
  /** The locked title (`notifications.softAsk.title`). */
  title: string;
  /** The member or staff body, already interpolated by the host. */
  body: string;
  /** The CTA label (`notifications.softAsk.cta`). */
  cta: string;
  /** The dismiss control's accessible name (`notifications.softAsk.dismiss`). */
  dismissLabel: string;
  /** While the permission prompt and the subscription run: the CTA shows `loading`, X is disabled. */
  busy?: boolean;
  /** The card is leaving (opacity to 0; the host unmounts it after the fade). */
  leaving?: boolean;
  onActivate: () => void;
  onDismiss: () => void;
  className?: string;
}

/**
 * The one-time soft-ask card at the top of `/notificacoes` (D-233, UI-D-255, sketch 007 surface 3).
 * Props-only: the module ships no words and decides nothing. The host decides eligibility after mount
 * (the server renders nothing), owns the permission flow, and passes every string.
 *
 * Geometry: `Card mx-4 mt-4 p-4 flex gap-3 items-start`; the 40px `bg-brand/10 text-brand` disc with
 * `BellRing` 20; a `min-w-0 flex-1` column (title 14/700, body 12/400 secondary `mt-1`, then the
 * brand `md` CTA with `Bell` 16 at auto width, `mt-3`); the 44×44 dismiss `X` 20 at `-mt-2 -mr-2`, so
 * the title wraps before it and never runs under it.
 */
export function SoftAskCard({
  title,
  body,
  cta,
  dismissLabel,
  busy = false,
  leaving = false,
  onActivate,
  onDismiss,
  className,
}: SoftAskCardProps) {
  return (
    <Card
      data-push-softask
      className={cn(
        'mx-4 mt-4 flex items-start gap-3 p-4 transition-opacity duration-150 motion-reduce:transition-none',
        leaving && 'opacity-0',
        className,
      )}
    >
      <span
        aria-hidden
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand/10 text-brand"
      >
        <BellRing size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-text">{title}</p>
        <p className="mt-1 text-xs text-text-secondary">{body}</p>
        <Button variant="brand" size="md" className="mt-3" loading={busy} onClick={onActivate}>
          {busy ? null : <Bell aria-hidden size={16} />}
          {cta}
        </Button>
      </div>
      <IconButton
        icon={X}
        size={20}
        label={dismissLabel}
        disabled={busy}
        onClick={onDismiss}
        className="-mt-2 -mr-2 shrink-0 text-text-tertiary"
      />
    </Card>
  );
}
