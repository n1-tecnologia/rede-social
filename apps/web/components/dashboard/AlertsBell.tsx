'use client';

import { IconButton } from '@rede-social/ui';
import { Bell, BellRing, X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

export interface AlertsBellProps {
  /** Accessible name with the count and, when urgent, how many are urgent ("Alertas, 3, 1 urgente"). */
  label: string;
  /** Accessible name of the panel's close button ("Fechar alertas"). */
  closeLabel: string;
  count: number;
  /** Any alert is danger: a ringing bell and the danger badge (shape too, never colour alone); otherwise a plain bell, brand-filled. */
  urgent: boolean;
  /** The server-rendered alert list shown when open. */
  children: ReactNode;
}

/**
 * The header's alerts disclosure: a bell with a count that shows the alert list under the header.
 * Closes on Escape (focus back to the bell), on a press outside and on a second press of the bell.
 */
export function AlertsBell({ label, closeLabel, count, urgent, children }: AlertsBellProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !rootRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    // No position class here: the panel anchors to the header's `relative` root so it spans the
    // header's width. It is a plain absolute child (no portal, top layer or fixed position), so it
    // scrolls with the profile inside the app's scroll root.
    <div ref={rootRef}>
      <IconButton
        ref={buttonRef}
        icon={urgent ? BellRing : Bell}
        label={label}
        count={count}
        badgeClassName={urgent ? undefined : 'bg-brand text-on-brand'}
        aria-expanded={open}
        aria-controls={panelId}
        data-alerts-bell
        onClick={() => setOpen((value) => !value)}
      />
      {/* z-5: above the panel content, below the app's z-50 TopBar. */}
      <div
        id={panelId}
        data-alerts-panel
        hidden={!open}
        className="absolute inset-x-0 top-full z-5 mt-2 max-h-96 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-bg-secondary p-3 shadow-lg"
      >
        <IconButton
          icon={X}
          label={closeLabel}
          className="absolute top-1 right-1"
          data-alerts-close
          onClick={() => {
            setOpen(false);
            buttonRef.current?.focus();
          }}
        />
        {children}
      </div>
    </div>
  );
}
