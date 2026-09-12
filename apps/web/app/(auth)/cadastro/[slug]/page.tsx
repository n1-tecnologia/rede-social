import { publicTenantSchema, slugSchema } from '@tria/contracts';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { env } from '@/lib/env';
import { getHostTenant, signupPath } from '@/lib/tenant-host';
import { SubmitButton } from '../../SubmitButton';
import { signup } from './actions';
import { PasswordField } from './PasswordField';
import { RulesSheet } from './RulesSheet';

/**
 * Public sign-up (AUTH-01, AUTH-04, D-01 as amended by D-22).
 *
 * The page ALWAYS receives a slug param: on a tenant domain `proxy.ts` rewrites `/cadastro` to
 * `/cadastro/{hostSlug}` (and 308s `/cadastro/*` back to `/cadastro`), so the host decides the tenant
 * and this page only cross-checks it. On generic hosts (localhost, Vercel Preview) the D-01 form
 * `/cadastro/{slug}` still works and `proxy.ts` remembers it in the `tenant_slug` cookie (D-06/D-21).
 */
/**
 * The canonical address of the shared link (D-22): `/cadastro` on the tenant's own domain — where
 * `/cadastro/{slug}` 308-redirects to — and `/cadastro/{slug}` on a generic host. The server action
 * computes the same base for its error redirects.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const [{ slug }, hostTenant] = await Promise.all([params, getHostTenant()]);
  return { alternates: { canonical: signupPath(hostTenant, slug) } };
}

export default async function CadastroPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ erro?: string; campos?: string }>;
}) {
  const [{ slug }, { erro, campos }, hostTenant, t] = await Promise.all([
    params,
    searchParams,
    getHostTenant(),
    getTranslations('signup'),
  ]);

  // Member sign-up is never offered on the platform domain (D-21) — defence in depth behind proxy.ts.
  if (hostTenant.mode === 'platform') redirect('/entrar');
  // D-22: on a tenant domain the host is the only authority for the slug.
  if (hostTenant.mode === 'tenant' && slug !== hostTenant.slug) notFound();
  if (!slugSchema.safeParse(slug).success) notFound();

  const res = await fetch(`${env.API_URL}/v1/public/tenants/${encodeURIComponent(slug)}`, {
    cache: 'no-store',
  });
  if (!res.ok) notFound();
  const parsed = publicTenantSchema.safeParse(await res.json());
  if (!parsed.success) notFound();
  const tenant = parsed.data;

  const invalidFields = (campos ?? '').split(',');

  return (
    <>
      <h1>{t('title')}</h1>
      <p>{tenant.displayName}</p>

      {erro === 'email-existente' ? (
        <p role="alert">
          {t('duplicateEmail')} <Link href="/entrar">{t('login')}</Link>
        </p>
      ) : null}
      {erro === 'validacao' ? (
        <p role="alert">{invalidFields.includes('password') ? t('passwordMin') : t('invalid')}</p>
      ) : null}

      <form action={signup} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="rulesVersion" value={tenant.rulesVersion} />
        <input type="hidden" name="termsVersion" value={tenant.termsVersion} />

        <label htmlFor="name">{t('name')}</label>
        <input id="name" name="name" type="text" autoComplete="name" required minLength={2} />

        <label htmlFor="email">{t('email')}</label>
        <input id="email" name="email" type="email" autoComplete="email" required />

        <PasswordField
          id="password"
          name="password"
          labels={{
            label: t('password'),
            show: t('showPassword'),
            hide: t('hidePassword'),
            min: t('passwordMin'),
            weak: t('strength.weak'),
            ok: t('strength.ok'),
            strong: t('strength.strong'),
          }}
        />

        {/* D-03 / AUTH-04: two separate controls, both unchecked, both required. */}
        <label htmlFor="acceptRules">
          <input id="acceptRules" name="acceptRules" type="checkbox" required />{' '}
          {t('acceptRules', { tenant: tenant.displayName })}
        </label>
        <RulesSheet
          trigger={t('viewRules')}
          title={t('rulesSheetTitle', { tenant: tenant.displayName })}
          close={t('closeRules')}
          rulesText={tenant.rulesText}
        />

        <label htmlFor="acceptTerms">
          <input id="acceptTerms" name="acceptTerms" type="checkbox" required /> {t('acceptTerms')}
        </label>
        <p style={{ margin: 0 }}>
          <Link href="/termos" target="_blank" rel="noreferrer">
            {t('termsLink')}
          </Link>
          {' · '}
          <Link href="/privacidade" target="_blank" rel="noreferrer">
            {t('privacyLink')}
          </Link>
        </p>

        <SubmitButton label={t('submit')} pendingLabel={t('pending')} />
      </form>

      <p>
        {t('haveAccount')} <Link href="/entrar">{t('login')}</Link>
      </p>
    </>
  );
}
