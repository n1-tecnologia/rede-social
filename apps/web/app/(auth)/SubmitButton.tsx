'use client';

import { useFormStatus } from 'react-dom';

/** The only client component of the auth pages: pending state for a server-action form. */
export function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}
