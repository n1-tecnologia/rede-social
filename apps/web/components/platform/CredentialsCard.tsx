import { Card, SectionTitle, StatusPill } from '@rede-social/ui';
import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  ReplaceCredentialsSheet,
  type ReplaceCredentialsSheetProps,
} from './ReplaceCredentialsSheet';

export interface CredentialsCardProps {
  tenantId: string;
  /** Whether the registry HOLDS the sealed values (never the values themselves). */
  held: boolean;
  /** "há 2 d" - computed on the server with `relativeFrom`; null when nothing was ever written. */
  updatedWhen: string | null;
  /** `replaceCredentialsAction`, handed down by the page. */
  replaceAction: ReplaceCredentialsSheetProps['action'];
}

/**
 * The Credenciais card of the Banco tab (09.2-19, UI-D-538, D-539, DBT-40). It says what the operator
 * needs to know and nothing more: the registry holds the access ("Guardadas", success) or does not
 * ("Não informadas", warning, which only a preparation that failed before its first step can leave), when
 * it was last replaced, and that the system never shows or returns the values. The one action,
 * "Substituir credenciais", stays available in both states.
 *
 * A Server Component; the sheet is the only client part. No value, length or hint of one is rendered:
 * the answer it is built from has no such field.
 */
export function CredentialsCard({
  tenantId,
  held,
  updatedWhen,
  replaceAction,
}: CredentialsCardProps) {
  const t = useTranslations('platform.database.credentials');

  return (
    <Card className="flex flex-col gap-4 p-4 md:p-6">
      <SectionTitle variant="micro">{t('title')}</SectionTitle>
      <div className="flex items-start gap-3">
        <Lock aria-hidden size={18} className="mt-0.5 shrink-0 text-text-secondary" />
        <p className="min-w-0 break-words text-sm text-text-secondary">
          {held ? t('body') : t('missingNote')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill tone={held ? 'success' : 'warning'}>
          {held ? t('held') : t('missing')}
        </StatusPill>
        {updatedWhen ? (
          <span className="text-xs text-text-tertiary">{t('updated', { when: updatedWhen })}</span>
        ) : null}
      </div>
      <div>
        <ReplaceCredentialsSheet tenantId={tenantId} action={replaceAction} />
      </div>
    </Card>
  );
}
