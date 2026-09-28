import { publicTenantSchema, slugSchema } from '@rede-social/contracts';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { env } from '@/lib/env';
import { getHostBrand } from '@/lib/host-brand';
import { getHostTenant, signupPath } from '@/lib/tenant-host';
import { AuthInput } from '../../AuthInput';
import { ConsentFields } from '../../ConsentFields';
import { PasswordField } from '../../PasswordField';
import { SubmitButton } from '../../SubmitButton';
import { UnavailableCard } from '../../UnavailableCard';
import { signup } from './actions';

/**
 * Public sign-up (AUTH-01, AUTH-04, D-01 as amended by D-22), on `@rede-social/ui` since 02-08 with the
 * Phase 1 fields, ids, hidden inputs and action untouched.
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

/** T-02-49: only these `?campos=` tokens map to a field message; anything else renders nothing. */
const FIELD_ERROR_KEYS = ['name', 'email', 'password'] as const;
type FieldErrorKey = (typeof FIELD_ERROR_KEYS)[number];

function isFieldErrorKey(value: string): value is FieldErrorKey {
  return (FIELD_ERROR_KEYS as readonly string[]).includes(value);
}

export default async function CadastroPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ erro?: string; campos?: string }>;
}) {
  const [{ slug }, { erro, campos }, hostTenant, brand, t, tu] = await Promise.all([
    params,
    searchParams,
    getHostTenant(),
    getHostBrand(),
    getTranslations('signup'),
    getTranslations('unavailable'),
  ]);

  // Member sign-up is never offered on the platform domain (D-21) — defence in depth behind proxy.ts.
  if (hostTenant.mode === 'platform') redirect('/entrar');
  // D-22: on a tenant domain the host is the only authority for the slug.
  if (hostTenant.mode === 'tenant' && slug !== hostTenant.slug) notFound();
  if (!slugSchema.safeParse(slug).success) notFound();
  // D-32: a suspended host answers with the branded card, not "não encontrada" (the API 404s anyway).
  if (brand.tenant?.status === 'suspended') {
    return <UnavailableCard title={tu('title')} body={tu('body')} />;
  }

  const res = await fetch(`${env.API_URL}/v1/public/tenants/${encodeURIComponent(slug)}`, {
    cache: 'no-store',
  });
  if (!res.ok) notFound();
  const parsed = publicTenantSchema.safeParse(await res.json());
  if (!parsed.success) notFound();
  const tenant = parsed.data;

  const invalidFields = new Set(
    erro === 'validacao' ? (campos ?? '').split(',').filter(isFieldErrorKey) : [],
  );
  const fieldError = (field: FieldErrorKey): string | undefined => {
    if (!invalidFields.has(field)) return undefined;
    return field === 'password' ? t('passwordMin') : t(`fieldErrors.${field}`);
  };

  return (
    <>
      <h1 className="text-center text-2xl font-bold tracking-[-0.02em] text-text">{t('title')}</h1>
      <p className="break-words text-center text-sm text-text-secondary">{tenant.displayName}</p>

      {erro === 'email-existente' ? (
        <p role="alert" className="text-center text-sm text-danger">
          {t('duplicateEmail')}{' '}
          <Link href="/entrar" className="font-bold text-brand">
            {t('login')}
          </Link>
        </p>
      ) : null}
      {erro === 'validacao' ? (
        <p role="alert" className="text-center text-sm text-danger">
          {invalidFields.has('password') ? t('passwordMin') : t('invalid')}
        </p>
      ) : null}

      <form action={signup} className="flex flex-col gap-4">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="rulesVersion" value={tenant.rulesVersion} />
        <input type="hidden" name="termsVersion" value={tenant.termsVersion} />

        <AuthInput
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          required
          minLength={2}
          icon="user"
          placeholder={t('name')}
          aria-label={t('name')}
          error={fieldError('name')}
        />
        <AuthInput
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          icon="mail"
          placeholder={t('email')}
          aria-label={t('email')}
          error={fieldError('email')}
        />
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
        <ConsentFields
          rulesText={tenant.rulesText}
          labels={{
            acceptRules: t('acceptRules', { tenant: tenant.displayName }),
            acceptTerms: t('acceptTerms'),
            viewRules: t('viewRules'),
            rulesSheetTitle: t('rulesSheetTitle', { tenant: tenant.displayName }),
            closeRules: t('closeRules'),
            termsLink: t('termsLink'),
            privacyLink: t('privacyLink'),
          }}
        />

        <SubmitButton label={t('submit')} pendingLabel={t('pending')} />
      </form>

      <p className="text-center text-sm text-text-secondary">
        {t('haveAccount')}{' '}
        <Link href="/entrar" className="font-bold text-brand">
          {t('login')}
        </Link>
      </p>
    </>
  );
}
