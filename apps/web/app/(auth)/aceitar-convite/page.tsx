import { publicTenantSchema } from '@rede-social/contracts';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { RearmProfileNudge } from '@/components/profile/RearmProfileNudge';
import { acceptInviteRedirectPath, getBootstrap, loadOrRedirect } from '@/lib/bootstrap';
import { env } from '@/lib/env';
import { ConsentFields } from '../ConsentFields';
import { PasswordField } from '../PasswordField';
import { SubmitButton } from '../SubmitButton';
import { acceptInvite } from './actions';

/**
 * "Aceitar convite" (ROLE-03, D-29, D-10, D-03; approved mockup `accept-invite`). The path is
 * PUBLIC in `proxy.ts`, but the page only renders with the session `/auth/confirm` created from the
 * invite link: the bootstrap is the authority on who is being onboarded and to which tenant
 * (D-23 — `requireAuth` already refused a host mismatch), so the heading names the membership
 * tenant and the sub-line the session's own e-mail. Never statically rendered (cookies through
 * `apiFetch`).
 *
 * Routing: no session / no membership -> `/convite-expirado`; an already-active membership (the
 * admin revisiting, or a consumed link with a live session) -> `/inicio`. `requireBootstrap()` is
 * NOT used here — it would redirect an invited session back to this page.
 *
 * The `(auth)` layout already paints the host brand, the column and the `AuthBrand` block; this
 * page renders only its column content. Token utilities only (UI-03). No "Comunidade:" line — the
 * heading already names the tenant — and no CTA competes with the brand button.
 */

/** T-02-126: only these `?campos=` tokens map to a message; anything else renders nothing. */
const FIELD_KEYS = [
  'password',
  'acceptRules',
  'acceptTerms',
  'rulesVersion',
  'termsVersion',
] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

function isFieldKey(value: string): value is FieldKey {
  return (FIELD_KEYS as readonly string[]).includes(value);
}

export default async function AceitarConvitePage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; campos?: string }>;
}) {
  const bootstrap = await loadOrRedirect(getBootstrap, acceptInviteRedirectPath);
  // Outside the helper (Next 16: `redirect()` never inside a try/catch).
  if (bootstrap.membership.status !== 'invited') redirect('/inicio');

  const [{ erro, campos }, t, ts] = await Promise.all([
    searchParams,
    getTranslations('acceptInvite'),
    getTranslations('signup'),
  ]);

  // The public tenant record carries the rules text + both consent versions the form must echo.
  const res = await fetch(
    `${env.API_URL}/v1/public/tenants/${encodeURIComponent(bootstrap.tenant.slug)}`,
    { cache: 'no-store' },
  );
  if (!res.ok) notFound();
  const parsed = publicTenantSchema.safeParse(await res.json());
  if (!parsed.success) notFound();
  const publicTenant = parsed.data;

  const tenant = bootstrap.tenant.displayName;
  const email = bootstrap.user.email;

  const invalidFields = new Set(
    erro === 'validacao' ? (campos ?? '').split(',').filter(isFieldKey) : [],
  );

  let alert: string | null = null;
  if (erro === 'validacao') {
    alert = invalidFields.has('password')
      ? ts('passwordMin')
      : invalidFields.has('acceptRules') || invalidFields.has('acceptTerms')
        ? t('errors.consents')
        : t('errors.validation');
  } else if (erro === 'consentimento') {
    alert = t('errors.staleConsent');
  } else if (erro === 'falha') {
    alert = t('errors.generic');
  }

  return (
    <>
      <h1 className="break-words text-center text-2xl font-bold tracking-[-0.02em] text-text">
        {t('title', { tenant })}
      </h1>
      <p className="break-all text-center text-sm text-text-secondary">
        {t('subtitle', { email })}
      </p>

      {alert ? (
        <p role="alert" className="text-center text-sm text-danger">
          {alert}
        </p>
      ) : null}

      <form action={acceptInvite} className="flex flex-col gap-4">
        <input type="hidden" name="rulesVersion" value={publicTenant.rulesVersion} />
        <input type="hidden" name="termsVersion" value={publicTenant.termsVersion} />

        <PasswordField
          id="password"
          name="password"
          autoComplete="new-password"
          labels={{
            label: t('password'),
            show: ts('showPassword'),
            hide: ts('hidePassword'),
            min: ts('passwordMin'),
            weak: ts('strength.weak'),
            ok: ts('strength.ok'),
            strong: ts('strength.strong'),
          }}
        />

        {/* D-03 / AUTH-04: two separate controls, both unchecked, both required — admins too. */}
        <ConsentFields
          rulesText={publicTenant.rulesText}
          labels={{
            acceptRules: ts('acceptRules', { tenant }),
            acceptTerms: ts('acceptTerms'),
            viewRules: ts('viewRules'),
            rulesSheetTitle: ts('rulesSheetTitle', { tenant }),
            closeRules: ts('closeRules'),
            termsLink: ts('termsLink'),
            privacyLink: ts('privacyLink'),
          }}
        />

        {/* An accepted invite starts a visit: SUBMITTING makes the "Complete seu perfil" popup due
            on Início (this page merely shown re-arms nothing). */}
        <RearmProfileNudge />
        <SubmitButton label={t('submit')} pendingLabel={t('pending')} />
      </form>
    </>
  );
}
