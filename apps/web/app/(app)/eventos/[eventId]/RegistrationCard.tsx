'use client';

import { CircleCheck, Receipt } from 'lucide-react';
import { useId, useState } from 'react';
import { ExampleTag } from '@/components/events/ExampleTag';

export interface RegistrationCardProps {
  title: string;
  /** "Ingresso RS-0042 · pagamento aprovado": an EXAMPLE line, tagged as such. */
  line: string;
  invoiceLabel: string;
  /** What a tap on "Ver nota fiscal" says: the invoice does not exist yet. */
  invoiceNote: string;
  exampleLabel: string;
}

/**
 * REINE's "Inscrição confirmada" (2026-10-06): the viewer IS going (that part is real); the ticket
 * code, the payment and the invoice are not in the system, so the line wears the "Exemplo" tag and
 * "Ver nota fiscal" opens a note saying so instead of an invoice.
 */
export function RegistrationCard({
  title,
  line,
  invoiceLabel,
  invoiceNote,
  exampleLabel,
}: RegistrationCardProps) {
  const [open, setOpen] = useState(false);
  const noteId = useId();
  return (
    <div
      data-testid="event-registration"
      className="flex items-start gap-2.5 rounded-xl border border-success/30 bg-success/10 px-3 py-2.5"
    >
      <CircleCheck aria-hidden size={20} className="mt-0.5 shrink-0 text-success" />
      <div className="min-w-0">
        <p className="text-sm font-bold leading-tight text-text">{title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-tertiary">
          <span>{line}</span>
          <ExampleTag label={exampleLabel} />
        </p>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={noteId}
          onClick={() => setOpen((value) => !value)}
          className="mt-1 flex h-4 w-fit items-center gap-1 rounded text-xs font-semibold text-brand active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Receipt aria-hidden size={13} />
          {invoiceLabel}
        </button>
        {open ? (
          <p id={noteId} className="mt-1.5 text-xs text-text-secondary">
            {invoiceNote}
          </p>
        ) : null}
      </div>
    </div>
  );
}
