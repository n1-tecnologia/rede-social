import { EmptyState } from '@rede-social/ui';
import { SearchX } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { LinkButton } from '../../LinkButton';

/** Unknown, suspended or malformed slug (D-01): never says whether the community ever existed. */
export default async function CadastroNotFound() {
  const [t, tc] = await Promise.all([getTranslations('signup'), getTranslations('common')]);
  return (
    <div className="w-full">
      <EmptyState
        icon={SearchX}
        title={t('tenantNotFound')}
        action={
          <LinkButton href="/entrar" variant="outline" size="lg" fullWidth>
            {tc('back')}
          </LinkButton>
        }
      />
    </div>
  );
}
