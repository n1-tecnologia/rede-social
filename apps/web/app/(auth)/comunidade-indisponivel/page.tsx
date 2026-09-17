import { EmptyState } from '@tria/ui';
import { TriangleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { LinkButton } from '../LinkButton';

/**
 * "Comunidade indisponível" (D-32). Reached through `/auth/suspended`, which has already cleared the
 * session, and directly by anyone on a suspended host. The `(auth)` layout still resolves the host,
 * so the screen is branded.
 *
 * Copy: `unavailable.title` / `unavailable.body` (pt-BR catalog). This component takes NO props and
 * reads no cookie, no header and no search param — by design: no reason, no moderator, no timestamp,
 * no tenant name beyond what the host brand already shows. Keep it that way.
 */
export default async function ComunidadeIndisponivelPage() {
  const [t, tc] = await Promise.all([getTranslations('unavailable'), getTranslations('common')]);

  return (
    <div className="w-full">
      <EmptyState
        icon={TriangleAlert}
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
