'use client';

import { Button, useToast } from '@rede-social/ui';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import type { VerifyDatabaseResult } from '@/app/(platform)/plataforma/tenants/[id]/banco/actions';

export interface VerifyDatabaseButtonProps {
  tenantId: string;
  /** The project is still being prepared: there is nothing to check yet, so the button waits (UI-D-536). */
  disabled?: boolean;
  /** `verifyDatabaseAction` - the API call and the revalidation live in the server action. */
  action: (tenantId: string) => Promise<VerifyDatabaseResult>;
}

/**
 * "Verificar agora" (D-543, A-UI-4): the outline `sm` button of the overview card - one read-only
 * health check, the Domínios tab's precedent. Pending it reads "Verificando…" with `aria-busy` (the
 * shipped `Button` `loading`); it is disabled while the project is being prepared. The toast is the
 * one catalog sentence of the answer: "Verificação concluída." or "Não foi possível verificar agora.
 * Tente novamente.". The new state arrives because the action revalidated the tenant views.
 *
 * It is NOT "Atualizar agora" and it is not a migrate button: a manual migration is the command's
 * job (D-544).
 */
export function VerifyDatabaseButton({
  tenantId,
  disabled = false,
  action,
}: VerifyDatabaseButtonProps) {
  const t = useTranslations('platform.database');
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const run = () => {
    startTransition(async () => {
      let ok = false;
      try {
        ok = (await action(tenantId)).ok;
      } catch {
        ok = false;
      }
      toast.show(
        ok
          ? { tone: 'success', message: t('overview.checked') }
          : { tone: 'error', message: t('errors.check') },
      );
    });
  };

  return (
    <Button variant="outline" size="sm" hitArea loading={pending} disabled={disabled} onClick={run}>
      {pending ? null : <RefreshCw aria-hidden size={16} />}
      {pending ? t('overview.checking') : t('overview.check')}
    </Button>
  );
}
