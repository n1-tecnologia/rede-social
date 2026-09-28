'use client';

import { Button, type ButtonVariant } from '@rede-social/ui';
import { useFormStatus } from 'react-dom';

/**
 * Pending state for a server-action form: `@rede-social/ui` `Button` `variant="brand" size="lg" fullWidth`
 * with `loading={pending}` (spinner, `aria-busy`, disabled) and the catalog's pending label
 * ("Entrando...", "Criando...", "Enviando...", "Salvando..."). The idle accessible name is the label.
 */
export function SubmitButton({
  label,
  pendingLabel,
  variant = 'brand',
}: {
  label: string;
  pendingLabel: string;
  variant?: ButtonVariant;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size="lg" fullWidth loading={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}
