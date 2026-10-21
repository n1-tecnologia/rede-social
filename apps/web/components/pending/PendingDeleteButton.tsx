import { cn, StatusPill } from '@rede-social/ui';
import { Trash2 } from 'lucide-react';
import { useId } from 'react';

export interface PendingDeleteButtonProps {
  /** The action's name, from the catalog ("Excluir evento"). */
  label: string;
  /** The pill beside it ("Em breve"). */
  soon: string;
  /** Why nothing happens, read with the button ("A exclusão de eventos ainda não está disponível."). */
  hint: string;
  /** What would be deleted, for the specs and the layout: `data-pending-delete="{kind}"`. */
  kind: string;
  className?: string;
}

/**
 * 2026-10-20 — the client's FRONT.pdf asks to delete an event and an archived community, and the
 * API has no route for either yet (`docs/pendencias-backend.md` items 11 and 12). Until it does, the
 * managers find the control where it will live, as a placeholder: the danger "Excluir" with
 * "Em breve" beside it, and NO action (no `onClick`, no server action, nothing sent).
 *
 * `aria-disabled`, never `disabled`: the button stays focusable, so a keyboard or screen reader user
 * reaches it and hears why it does nothing (the `hint`, its description, visually hidden). It is
 * `type="button"`, so inside a form it never submits. No `'use client'`: it holds no state, so the
 * server pages (the event's banner) and the client forms render the same component.
 */
export function PendingDeleteButton({
  label,
  soon,
  hint,
  kind,
  className,
}: PendingDeleteButtonProps) {
  const hintId = useId();
  return (
    <div
      data-pending-delete={kind}
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}
    >
      <button
        type="button"
        aria-disabled="true"
        aria-describedby={hintId}
        className="inline-flex h-11 cursor-not-allowed items-center gap-2 rounded-xl text-sm font-bold text-danger opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <Trash2 aria-hidden size={20} />
        {label}
      </button>
      <StatusPill tone="neutral">{soon}</StatusPill>
      <span id={hintId} className="sr-only">
        {hint}
      </span>
    </div>
  );
}
