import { publicTenantSchema } from '@rede-social/contracts';
import { type JoinState, joinStateSchema } from '@rede-social/contracts/join';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { RearmProfileNudge } from '@/components/profile/RearmProfileNudge';
import { apiFetch } from '@/lib/api';
import { env } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { getHostTenant } from '@/lib/tenant-host';
import { AuthInput } from '../AuthInput';
import { ConsentFields } from '../ConsentFields';
import { SubmitButton } from '../SubmitButton';
import { UnavailableCard } from '../UnavailableCard';
import { declineJoin, join } from './actions';

/**
 * "Participar de {tenant}" (08.1, D-305, D-306, D-311; UI-SPEC UI-D-320). Reached when the bootstrap
 * answers TENANT_HOST_MISMATCH: the session is signed in on THIS tenant host but holds no membership
 * here. NOT public in `proxy.ts` — without a session it falls through to `/entrar`. Never statically
 * rendered (cookies through `apiFetch`).
 *
 * `GET /v1/join/state` is the authority on what this identity may do here, and it only ever speaks
 * about the host's community (D-302, D-309): the page names that community (from the host) and the
 * session's own e-mail, never another community. The `(auth)` layout already paints the host brand.
 *
 * Routing (every target computed first, `redirect()` outside any try/catch, Next 16 rule): a host that
 * is not a tenant host -> `/inicio`; no session (401) -> `/entrar`; 404 (an API that predates
 * `/v1/join`, the web-before-API deploy window) -> `/auth/host-mismatch`, today's behaviour; `member`
 * -> `/inicio`; `invited` -> `/aceitar-convite`; `blocked` -> `/auth/blocked`; `suspended` ->
 * `/auth/suspended`; `platform_admin` -> `/auth/host-mismatch` (D-316, signed out); `removed` or
 * `?erro=recusado` -> the refused card; `joinable` -> the form, with the name field EMPTY (D-311).
 */

/** UI-D-320 / T-02-49: only these `?campos=` tokens map to a message; anything else renders nothing. */
const FIELD_KEYS = ['name', 'acceptRules', 'acceptTerms', 'rulesVersion', 'termsVersion'] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

function isFieldKey(value: string): value is FieldKey {
  return (FIELD_KEYS as readonly string[]).includes(value);
}

type Outcome = { kind: 'redirect'; to: string } | { kind: 'refused' } | { kind: 'form' };

function outcomeFor(state: JoinState, tenantName: string): Outcome {
  switch (state) {
    case 'joinable':
      return { kind: 'form' };
    case 'member':
      return { kind: 'redirect', to: '/inicio' };
    case 'invited':
      return { kind: 'redirect', to: '/aceitar-convite' };
    case 'blocked':
      return { kind: 'redirect', to: `/auth/blocked?t=${encodeURIComponent(tenantName)}` };
    case 'suspended':
      return { kind: 'redirect', to: '/auth/suspended' };
    case 'platform_admin':
      return { kind: 'redirect', to: '/auth/host-mismatch' };
    case 'removed':
      return { kind: 'refused' };
  }
}

async function loadOutcome(tenantName: string): Promise<Outcome> {
  const res = await apiFetch('/v1/join/state');
  if (res.status === 401) return { kind: 'redirect', to: '/entrar' };
  if (res.status === 404) return { kind: 'redirect', to: '/auth/host-mismatch' };
  if (!res.ok) throw new Error(`GET /v1/join/state answered ${res.status}`);
  const { state } = joinStateSchema.parse(await res.json());
  return outcomeFor(state, tenantName);
}

export default async function ParticiparPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; campos?: string }>;
}) {
  const [{ erro, campos }, hostTenant, t, ts] = await Promise.all([
    searchParams,
    getHostTenant(),
    getTranslations('join'),
    getTranslations('signup'),
  ]);
  if (hostTenant.mode !== 'tenant') redirect('/inicio');

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims) redirect('/entrar');

  const tenant = hostTenant.displayName;
  const outcome = await loadOutcome(tenant);
  if (outcome.kind === 'redirect') redirect(outcome.to);

  const declineForm = (label: string) => (
    <form action={declineJoin} className="flex justify-center">
      <button
        type="submit"
        className="min-h-11 rounded-xl px-4 text-sm font-bold text-text-secondary transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        {label}
      </button>
    </form>
  );

  if (outcome.kind === 'refused' || erro === 'recusado') {
    return (
      <>
        <UnavailableCard title={t('refused.title')} body={t('refused.body')} />
        {declineForm(t('refused.cta'))}
      </>
    );
  }

  // The public tenant record carries the rules text + both consent versions the form must echo.
  const res = await fetch(
    `${env.API_URL}/v1/public/tenants/${encodeURIComponent(hostTenant.slug)}`,
    { cache: 'no-store' },
  );
  if (!res.ok) notFound();
  const parsed = publicTenantSchema.safeParse(await res.json());
  if (!parsed.success) notFound();
  const publicTenant = parsed.data;

  const email = typeof claims.email === 'string' ? claims.email : '';
  const invalidFields = new Set(
    erro === 'validacao' ? (campos ?? '').split(',').filter(isFieldKey) : [],
  );

  let alert: string | null = null;
  if (erro === 'validacao') {
    alert =
      invalidFields.has('acceptRules') || invalidFields.has('acceptTerms')
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

      <form action={join} className="flex flex-col gap-4">
        <input type="hidden" name="rulesVersion" value={publicTenant.rulesVersion} />
        <input type="hidden" name="termsVersion" value={publicTenant.termsVersion} />

        <div className="flex flex-col gap-1.5">
          {/* D-311: never pre-filled — the name a person uses in another community is not copied. */}
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
            error={invalidFields.has('name') ? t('fieldErrors.name') : undefined}
          />
          <p className="text-xs text-text-tertiary">{t('nameHint', { tenant })}</p>
        </div>

        {/* D-03 / AUTH-04: two separate controls, both unchecked, both required. */}
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

        {/* D-311: a new membership starts a new visit — SUBMITTING makes the "Complete seu perfil"
            popup due on Início, as for any new member. */}
        <RearmProfileNudge />
        <SubmitButton label={t('submit')} pendingLabel={t('pending')} />
      </form>

      {declineForm(t('decline'))}
    </>
  );
}
