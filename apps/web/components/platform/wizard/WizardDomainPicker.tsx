'use client';

import { Button, Card, Input } from '@rede-social/ui';
import { Globe } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { LinkButton } from '@/app/(auth)/LinkButton';
import { validateDomainHostAction } from '@/app/(platform)/plataforma/novo/actions';
import { useTenantDraft } from './TenantDraftProvider';

/**
 * Step 3 (Domínio) before the tenant exists: the host is only RECORDED (optional). "Continuar"
 * checks it with the attach schema in the web tier (no request) and keeps the normalised host;
 * after the summary's confirmation it is attached to the new tenant, and the invite step shows its
 * DNS records and verification, which need the tenant to exist. Typing clears the draft's
 * `hostReady` until that check passes again, so the summary (and its confirmation) never receives a
 * host this step did not accept.
 */
export function WizardDomainPicker() {
  const t = useTranslations('platformDomains');
  const tw = useTranslations('platform.wizard');
  const router = useRouter();
  const { draft, restored, update } = useTenantDraft();
  const [problem, setProblem] = useState<'invalid' | 'unchecked' | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const host = draft.host.trim();
    if (!host) {
      update({ host: '', hostReady: true });
      router.push('/plataforma/novo/resumo');
      return;
    }
    setPending(true);
    try {
      const result = await validateDomainHostAction(host);
      if (!result.ok) {
        setProblem('invalid');
        return;
      }
      update({ host: result.host, hostReady: true });
      router.push('/plataforma/novo/resumo');
    } catch (error) {
      // The check never ran (network, a restarting server): nothing says the host is wrong.
      console.error('platform.domains.validate_failed', { error: String(error) });
      setProblem('unchecked');
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      data-draft-ready={restored ? '' : undefined}
      className="flex flex-col gap-6"
    >
      <Card className="flex flex-col gap-3 p-4 md:p-6">
        <Input
          id="host"
          name="host"
          icon={Globe}
          label={t('add.label')}
          placeholder={t('add.placeholder')}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={draft.host}
          onChange={(event) => {
            setProblem(null);
            const host = event.target.value;
            update({ host, hostReady: host.trim() === '' });
          }}
          error={
            problem === 'invalid'
              ? t('errors.invalid')
              : problem === 'unchecked'
                ? tw('errors.checkFailed')
                : undefined
          }
        />
        <p className="text-xs text-text-tertiary">{tw('domain.helper')}</p>
      </Card>
      <div className="flex flex-col-reverse gap-3 md:flex-row md:items-center md:justify-between">
        <LinkButton href="/plataforma/novo/marca" variant="ghost">
          {tw('actions.back')}
        </LinkButton>
        <Button
          type="submit"
          variant="brand"
          size="lg"
          loading={pending}
          className="w-full md:w-auto"
        >
          {pending ? tw('actions.checking') : tw('actions.next')}
        </Button>
      </div>
    </form>
  );
}
