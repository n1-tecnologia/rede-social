import { EmptyState } from '@rede-social/ui';
import { Link2Off } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { LinkButton } from '../LinkButton';

/**
 * "Endereço incorreto" (TENANT-01, D-23). Reached only through `/auth/host-mismatch`, which has
 * already cleared the session.
 *
 * Copy: `hostMismatch.title` / `hostMismatch.body` (pt-BR catalog).
 * This component takes NO props and reads no cookie, no header and no search param — by design. The
 * screen must not reveal which community the account belongs to, nor which community this address
 * serves, so it has nothing tenant-specific to read in the first place. Keep it that way.
 */
export default async function EnderecoInvalidoPage() {
  const [t, tc] = await Promise.all([getTranslations('hostMismatch'), getTranslations('common')]);

  return (
    <div className="w-full">
      <EmptyState
        icon={Link2Off}
        title={t('title')}
        body={t('body')}
        action={
          <LinkButton href="/entrar" variant="outline" size="lg" fullWidth>
            {tc('back')}
          </LinkButton>
        }
      />
    </div>
  );
}
