import { EmptyState } from '@rede-social/ui';
import { UserX } from 'lucide-react';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { getHostTenant, signupPath } from '@/lib/tenant-host';
import { LinkButton } from '../LinkButton';

/**
 * "Conta sem comunidade" (orphan identity): a valid session whose user has no membership row, which
 * the API answers with 403 `NO_MEMBERSHIP`. It is a safety net, not a normal path — sign-up creates
 * identity and membership in one transaction — but a deleted membership or a half-finished manual
 * fixture must not leave someone staring at an error boundary.
 *
 * Where "cadastrar" points follows the same host rules as `/entrar` (D-22):
 * - tenant host: the host decides the community, so `/cadastro` with no slug;
 * - generic host: the `tenant_slug` cookie remembers the last community visited (D-06);
 * - platform host or no cookie: nothing to offer, back to `/entrar`.
 */
export default async function SemComunidadePage() {
  const [hostTenant, t, tc] = await Promise.all([
    getHostTenant(),
    getTranslations('noCommunity'),
    getTranslations('common'),
  ]);

  let cta: { href: string; tenant: string } | null = null;
  if (hostTenant.mode === 'tenant') {
    cta = { href: signupPath(hostTenant, hostTenant.slug), tenant: hostTenant.displayName };
  } else if (hostTenant.mode === 'generic') {
    const slug = (await cookies()).get('tenant_slug')?.value;
    if (slug && /^[a-z0-9-]+$/.test(slug)) {
      cta = { href: signupPath(hostTenant, slug), tenant: slug };
    }
  }

  return (
    <div className="w-full">
      <EmptyState
        icon={UserX}
        title={t('title')}
        body={t('body')}
        action={
          cta ? (
            <LinkButton href={cta.href} variant="outline" size="lg" fullWidth>
              {t('cta', { tenant: cta.tenant })}
            </LinkButton>
          ) : (
            <LinkButton href="/entrar" variant="outline" size="lg" fullWidth>
              {tc('back')}
            </LinkButton>
          )
        }
      />
    </div>
  );
}
