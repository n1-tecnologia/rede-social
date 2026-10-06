'use client';

import { Award } from 'lucide-react';
import { useState } from 'react';
import { ExampleTag } from '@/components/events/ExampleTag';

/**
 * The "Certificado" button of an event taken part in (2026-10-06, REINE's `ParticipatedCard`). The
 * event really has a certificate (its organiser said so in step 2), but the system does not issue
 * the file yet: a tap says so, with the example tag, instead of downloading anything.
 */
export function CertificateButton({
  label,
  note,
  exampleLabel,
}: {
  label: string;
  note: string;
  exampleLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-1 flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-button bg-(image:--button-image) text-xs font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover) active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <Award aria-hidden size={14} />
        {label}
      </button>
      {open ? (
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-text-secondary">
          <ExampleTag label={exampleLabel} />
          {note}
        </p>
      ) : null}
    </div>
  );
}
