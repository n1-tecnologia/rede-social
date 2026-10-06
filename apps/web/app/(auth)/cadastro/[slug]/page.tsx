import { publicTenantSchema, slugSchema } from '@rede-social/contracts';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { RearmProfileNudge } from '@/components/profile/RearmProfileNudge';
import { env } from '@/lib/env';
import { getHostBrand } from '@/lib/host-brand';
import { readJoinDraft } from '@/lib/join-draft';
import { getHostTenant, signupPath } from '@/lib/tenant-host';
import { AuthInput } from '../../AuthInput';
import { ConsentFields } from '../../ConsentFields';
import { PasswordField } from '../../PasswordField';
import { SubmitButton } from '../../SubmitButton';
import { UnavailableCard } from '../../UnavailableCard';
import { joinFromSignup, signup } from './actions';

/**
 * Public sign-up (AUTH-01, AUTH-04, D-01 as amended by D-22), on `@rede-social/ui` since 02-08 with the
 * Phase 1 fields, ids, hidden inputs and action untouched.
 *
 * The page ALWAYS receives a slug param: on a tenant domain `proxy.ts` rewrites `/cadastro` to
 * `/cadastro/{hostSlug}` (and 308s `/cadastro/*` back to `/cadastro`), so the host decides the tenant
 * and this page only cross-checks it. On generic hosts (localhost, Vercel Preview) the D-01 form
 * `/cadastro/{slug}` still works and `proxy.ts` remembers it in the `tenant_slug` cookie (D-06/D-21).
 *
 * 08.1 (D-301, D-302, D-303; UI-SPEC UI-D-321): `?estado=ja-tem-conta` plus a readable `join_draft`
 * cookie turns the page into "Você já tem uma conta. Digite sua senha para participar de {tenant}",
 * where `{tenant}` is THIS page's community and the e-mail is the one the person typed (read-only,
 * from the HttpOnly draft, never from the URL). Nothing on that state names another community. With
 * the cookie absent or unreadable the plain form comes back with the "preencha novamente" notice.
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

/** The "já tem conta" state's whitelisted `?campos=` tokens (UI-D-321, same T-02-49 rule). */
const EXISTING_FIELD_KEYS = [
  'password',
  'acceptRules',
  'acceptTerms',
  'rulesVersion',
  'termsVersion',
] as const;
type ExistingFieldKey = (typeof EXISTING_FIELD_KEYS)[number];

function isExistingFieldKey(value: string): value is ExistingFieldKey {
  return (EXISTING_FIELD_KEYS as readonly string[]).includes(value);
}

export default async function CadastroPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ erro?: string; campos?: string; estado?: string }>;
}) {
  const [{ slug }, { erro, campos, estado }, hostTenant, brand, t, tu, tj] = await Promise.all([
    params,
    searchParams,
    getHostTenant(),
    getHostBrand(),
    getTranslations('signup'),
    getTranslations('unavailable'),
    getTranslations('join'),
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

  const consentLabels = {
    acceptRules: t('acceptRules', { tenant: tenant.displayName }),
    acceptTerms: t('acceptTerms'),
    viewRules: t('viewRules'),
    rulesSheetTitle: t('rulesSheetTitle', { tenant: tenant.displayName }),
    closeRules: t('closeRules'),
    termsLink: t('termsLink'),
    privacyLink: t('privacyLink'),
  };

  const existingState = estado === 'ja-tem-conta';
  const draft = existingState ? await readJoinDraft() : null;

  if (draft) {
    const invalid = new Set(
      erro === 'validacao' ? (campos ?? '').split(',').filter(isExistingFieldKey) : [],
    );
    let alert: string | null = null;
    if (erro === 'senha') {
      alert = t('existing.wrongPassword');
    } else if (erro === 'recusado') {
      alert = t('existing.refused');
    } else if (erro === 'validacao') {
      if (invalid.has('acceptRules') || invalid.has('acceptTerms')) alert = tj('errors.consents');
      else if (invalid.has('password')) alert = t('passwordMin');
      else alert = tj('errors.validation');
    } else if (erro === 'consentimento') {
      alert = tj('errors.staleConsent');
    } else if (erro === 'falha') {
      alert = tj('errors.generic');
    }

    return (
      <>
        <h1 className="break-words text-center text-2xl font-bold tracking-[-0.02em] text-text">
          {t('existing.title', { tenant: tenant.displayName })}
        </h1>
        <p className="break-all text-center text-sm text-text">{draft.email}</p>

        {alert ? (
          <p role="alert" className="text-center text-sm text-danger">
            {alert}
          </p>
        ) : null}

        <form action={joinFromSignup} className="flex flex-col gap-4">
          {hostTenant.mode === 'generic' ? <input type="hidden" name="slug" value={slug} /> : null}
          <input type="hidden" name="rulesVersion" value={tenant.rulesVersion} />
          <input type="hidden" name="termsVersion" value={tenant.termsVersion} />

          <PasswordField
            id="password"
            name="password"
            autoComplete="current-password"
            labels={{
              label: t('existing.password'),
              show: t('showPassword'),
              hide: t('hidePassword'),
              min: t('passwordMin'),
              weak: t('strength.weak'),
              ok: t('strength.ok'),
              strong: t('strength.strong'),
            }}
            error={invalid.has('password') ? t('passwordMin') : undefined}
          />

          {/* D-306: the same two controls as the sign-up, both unchecked, both required. */}
          <ConsentFields rulesText={tenant.rulesText} labels={consentLabels} />

          {/* D-311: a new membership starts a new visit, as for any new member. */}
          <RearmProfileNudge />
          <SubmitButton label={t('existing.submit')} pendingLabel={t('existing.pending')} />
        </form>

        <p className="text-center text-sm text-text-secondary">
          {/* D-303: recovery starts on THIS host, so its mail is this community's. */}
          <Link href="/esqueci-senha" className="font-bold text-brand">
            {t('existing.forgot')}
          </Link>
          {' · '}
          <Link href={signupPath(hostTenant, slug)} className="font-bold text-brand">
            {t('existing.otherEmail')}
          </Link>
        </p>
      </>
    );
  }

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

      {existingState ? (
        <p role="status" className="text-center text-sm text-text-secondary">
          {t('existing.expired')}
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
        <ConsentFields rulesText={tenant.rulesText} labels={consentLabels} />

        {/* A new member starts a new visit: SUBMITTING makes the "Complete seu perfil" popup due on
            Início (this page merely shown re-arms nothing). */}
        <RearmProfileNudge />
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
