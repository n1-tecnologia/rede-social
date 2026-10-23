'use server';

import {
  apiErrorEnvelopeSchema,
  isAllowlistRejection,
  isRegistrableHost,
  normalizeHost,
  passwordSchema,
  publicTenantSchema,
  signupFormSchema,
  slugSchema,
} from '@rede-social/contracts';
import { joinFormSchema } from '@rede-social/contracts/join';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { apiFetchWithToken } from '@/lib/api';
import { env } from '@/lib/env';
import { heldOf, heldOfCode, heldPath } from '@/lib/held-out';
import { getHostBrand } from '@/lib/host-brand';
import { clearJoinDraft, readJoinDraft, writeJoinDraft } from '@/lib/join-draft';
import { isEmailNotConfirmed, writePendingConfirmation } from '@/lib/pending-confirmation';
import { sendSignupConfirmation } from '@/lib/signup-confirmation';
import { createClient } from '@/lib/supabase/server';
import { getHostTenant, signupPath } from '@/lib/tenant-host';

/** The query that puts `/cadastro` into the "já tem conta" state (UI-D-321). Never carries the e-mail. */
const EXISTING_STATE = 'estado=ja-tem-conta';

/** The client's IP and user agent, forwarded to the API for its audit lines (never for decisions). */
async function clientHeaders(): Promise<Record<string, string>> {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim();
  const clientIp = requestHeaders.get('x-real-ip') ?? forwarded ?? '';
  const userAgent = requestHeaders.get('user-agent') ?? '';
  return {
    ...(clientIp ? { 'X-Client-IP': clientIp } : {}),
    ...(userAgent ? { 'User-Agent': userAgent } : {}),
  };
}

/**
 * 09.2-17 (D-36, D-538, decision 4): where a sign-up made on a GENERIC host must continue.
 *
 * A generic host (localhost, a Vercel preview) always talks to the CENTRAL project's Auth. A tenant that
 * lives in another project has its members' sessions only on its own host, so the person is sent to
 * `https://<primaryHost>/entrar` instead of being signed in here. The answer is the public slug record:
 * `supabaseUrl` is present only for a tenant of another project, and `primaryHost` is its verified primary
 * host (the API answers 404 for such a tenant without one). `null` means "a tenant of the central project,
 * or no usable record": the flow continues exactly as before and the POST decides (404 included).
 */
async function foreignProjectEntrance(slug: string): Promise<string | null> {
  const res = await fetch(`${env.API_URL}/v1/public/tenants/${encodeURIComponent(slug)}`, {
    cache: 'no-store',
  }).catch(() => null);
  if (!res?.ok) return null;
  // A 200 the contract cannot read (a primary host that is not a host, say) is a 404, never the
  // central flow: the record is the only thing that says which project this tenant lives in.
  const parsed = publicTenantSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) notFound();
  if (!parsed.data.supabaseUrl) return null;

  const host = normalizeHost(parsed.data.primaryHost);
  if (!host || !isRegistrableHost(host)) notFound();
  return `https://${host}/entrar`;
}

/**
 * Sign-up (AUTH-01, AUTH-04, D-04): validate -> API (the only party allowed to bind an identity to a
 * tenant; the identity is created UNCONFIRMED) -> ask GoTrue for the confirmation mail -> the
 * `/verifique-seu-email` screen. The person is NOT signed in: the mail link confirms the e-mail and
 * signs in (quick 261007-gbk, superseding "no e-mail confirmation in the pilot" of D-04).
 *
 * D-22: on a tenant domain the HOST decides the tenant and the hidden `slug` field is ignored, so a
 * forged slug in the form can never enrol someone in a foreign community (T-04-08). On generic hosts
 * the hidden field carries the D-01 slug the page was rendered for.
 *
 * D-301 / D-302: an e-mail that already has an identity (the API's detail-less 409) no longer ends in
 * an alert. The e-mail and the typed name go into the HttpOnly `join_draft` cookie (never the password,
 * never a URL) and the page turns into the "já tem conta" state, where `joinFromSignup` confirms the
 * EXISTING password. Nothing about where else the identity is a member is known or shown here.
 *
 * The password is never logged and never placed in a URL.
 */
export async function signup(formData: FormData): Promise<void> {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/entrar');
  // 09.2-21 (UI-D-542): a host held out (suspended, unreachable, updating, preparing) refuses the
  // sign-up before anything is read, sent or remembered. No cookie is cleared.
  const held = heldOf((await getHostBrand()).tenant?.status);
  if (held) redirect(heldPath(held));

  const formSlug = String(formData.get('slug') ?? '');
  const slug = hostTenant.mode === 'tenant' ? hostTenant.slug : formSlug;
  const base = signupPath(hostTenant, slug);

  const parsed = signupFormSchema.safeParse({
    name: String(formData.get('name') ?? ''),
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
    consents: {
      tenantRulesVersion: Number(formData.get('rulesVersion')),
      platformTermsVersion: Number(formData.get('termsVersion')),
    },
    // Unchecked boxes are absent from the FormData entirely; `z.literal(true)` then fails (AUTH-04).
    acceptRules: formData.get('acceptRules') === 'on',
    acceptTerms: formData.get('acceptTerms') === 'on',
  });
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? 'form'))),
    ];
    redirect(`${base}?erro=validacao&campos=${encodeURIComponent(fields.join(','))}`);
  }

  const { acceptRules: _acceptRules, acceptTerms: _acceptTerms, ...body } = parsed.data;

  // 09.2-17: on a generic host the central Auth cannot sign anybody in to a tenant of another project.
  const foreignEntrance = hostTenant.mode === 'generic' ? await foreignProjectEntrance(slug) : null;

  const res = await fetch(`${env.API_URL}/v1/public/signup/${encodeURIComponent(slug)}`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(await clientHeaders()) },
    body: JSON.stringify(body),
  });

  if (foreignEntrance && (res.ok || res.status === 409)) {
    // The account now exists (or already did) in the tenant's own project: no confirmation mail from
    // here, no pending-confirmation cookie on this host, no "já tem conta" draft. The tenant's own host
    // continues from its sign-in page (and resends the confirmation from there, against its own Auth).
    redirect(foreignEntrance);
  }
  if (res.status === 409) {
    await writeJoinDraft({ email: body.email, name: body.name });
    redirect(`${base}?${EXISTING_STATE}`);
  }
  if (res.status === 404) notFound();
  if (res.status === 503) {
    // 09.2-11: the slug route refuses a tenant that is preparing, updating or unreachable (no details);
    // on a generic host this is the only place that learns it. Nothing was created.
    const envelope = apiErrorEnvelopeSchema.safeParse(await res.json().catch(() => null));
    const heldByCode = envelope.success ? heldOfCode(envelope.data.error.code) : null;
    if (heldByCode) redirect(heldPath(heldByCode));
  }
  if (res.status === 403) {
    // Quick 261018-owq: the e-mail is not `liberado` on the global allowlist. Any other 403 falls
    // through to the generic answer below.
    const envelope = apiErrorEnvelopeSchema.safeParse(await res.json().catch(() => null));
    if (envelope.success && envelope.data.error.code === 'EMAIL_NOT_ALLOWED') {
      redirect(`${base}?erro=nao-liberado`);
    }
  }
  if (!res.ok) redirect(`${base}?erro=validacao`);

  // The address lives in an HttpOnly cookie, never in the URL; `sentAt` starts the resend cooldown.
  await writePendingConfirmation({ email: body.email, sentAt: Date.now() });
  await sendSignupConfirmation(body.email);

  redirect('/verifique-seu-email');
}

/** Zod paths of the "já tem conta" form -> the `?campos=` tokens the page whitelists (T-02-49 rule). */
function fieldToken(path: readonly PropertyKey[]): string {
  const [head, leaf] = path.map(String);
  if (head === 'consents') return leaf === 'tenantRulesVersion' ? 'rulesVersion' : 'termsVersion';
  return head ?? 'form';
}

/**
 * "Participar" on the "já tem conta" state (08.1, D-301; UI-SPEC UI-D-321).
 *
 * 1. Host rules exactly as `signup`: the platform host never offers it, a tenant host decides the
 *    community (D-22), a generic host uses the hidden slug the page was rendered for.
 * 2. The draft cookie names the identity; without it the page shows the expired notice.
 * 3. The EXISTING password is proven with `signInWithPassword` on THIS origin. A wrong one goes back
 *    with `erro=senha` and nothing is written (D-301 step 4): the join endpoint is never called.
 * 4. `POST /v1/join` with the access token that sign-in just returned (`apiFetchWithToken`, RESEARCH
 *    Pitfall 5), carrying the name typed at sign-up (D-311) and the two consent versions shown (D-306).
 *    Whether the identity is already a member here, blocked here or a platform account surfaces only
 *    now, after the password (D-302).
 *
 * Every target is computed first and `redirect()` is called outside the try/catch (Next 16 rule).
 * Neither the e-mail, the name nor the password ever reaches a URL; only whitelisted field tokens do.
 */
export async function joinFromSignup(formData: FormData): Promise<void> {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/entrar');
  // 09.2-21 (UI-D-542): refused for a held-out host before the password is proven anywhere.
  const held = heldOf((await getHostBrand()).tenant?.status);
  if (held) redirect(heldPath(held));

  const formSlug = String(formData.get('slug') ?? '');
  const slug = hostTenant.mode === 'tenant' ? hostTenant.slug : formSlug;
  if (!slugSchema.safeParse(slug).success) notFound();
  const state = `${signupPath(hostTenant, slug)}?${EXISTING_STATE}`;

  const draft = await readJoinDraft();
  if (!draft) redirect(state);

  const password = String(formData.get('password') ?? '');
  const parsed = joinFormSchema.safeParse({
    name: draft.name,
    consents: {
      tenantRulesVersion: Number(formData.get('rulesVersion')),
      platformTermsVersion: Number(formData.get('termsVersion')),
    },
    // Unchecked boxes are absent from the FormData entirely; `z.literal(true)` then fails (AUTH-04).
    acceptRules: formData.get('acceptRules') === 'on',
    acceptTerms: formData.get('acceptTerms') === 'on',
  });
  const passwordOk = passwordSchema.safeParse(password).success;
  if (!parsed.success || !passwordOk) {
    const fields = new Set(
      parsed.success ? [] : parsed.error.issues.map((issue) => fieldToken(issue.path)),
    );
    if (!passwordOk) fields.add('password');
    redirect(`${state}&erro=validacao&campos=${encodeURIComponent([...fields].join(','))}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: draft.email,
    password,
  });
  // D-301 step 4: a wrong password writes nothing, and the answer never says more than "incorrect".
  if (error && isEmailNotConfirmed(error)) {
    // The right password on an identity that never confirmed its e-mail (it signed up elsewhere and
    // never opened the mail): the verification screen, not a wrong-password message.
    await writePendingConfirmation({ email: draft.email });
    redirect('/verifique-seu-email?erro=nao-confirmado');
  }
  // Quick 261018-owq: the right password on an e-mail the allowlist refuses (the token hook said no).
  // This used to read as "Senha incorreta".
  if (error && isAllowlistRejection(error)) redirect(`${state}&erro=nao-liberado`);
  if (error || !data.session) redirect(`${state}&erro=senha`);
  const accessToken = data.session.access_token;

  let target: string;
  let signOutLocally = false;
  try {
    const res = await apiFetchWithToken(accessToken, '/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await clientHeaders()) },
      body: JSON.stringify({
        name: parsed.data.name,
        consents: parsed.data.consents,
        ...(hostTenant.mode === 'generic' ? { slug } : {}),
      }),
    });
    if (res.ok) {
      // `joined` and `already_member` both enter: an existing member who "signs up" again simply
      // lands on Início, and the API wrote nothing for them.
      await clearJoinDraft();
      target = '/inicio';
    } else {
      const envelope = apiErrorEnvelopeSchema.safeParse(await res.json().catch(() => null));
      const apiError = envelope.success ? envelope.data.error : null;
      if (res.status === 403 && apiError?.code === 'MEMBERSHIP_BLOCKED') {
        // D-304. The `/auth/blocked` handler signs out too, but a server-action redirect reaches it
        // through the router's fetch and its cookie clear does not stick, so the action signs out.
        signOutLocally = true;
        target = `/auth/blocked?t=${encodeURIComponent(String(apiError.details?.tenantName ?? ''))}`;
      } else if (res.status === 403 && apiError?.code === 'SUBSCRIPTION_PENDING') {
        // 09.1-15 (D-497, D-499): a payment cut is not a block — the session is kept, only "Sair" on the
        // pending screen ends it (the identity is shared across communities).
        target = `/assinatura-pendente?t=${encodeURIComponent(String(apiError.details?.tenantName ?? ''))}`;
      } else if (res.status === 403 && apiError?.code === 'EMAIL_NOT_ALLOWED') {
        // 09.1-15 (D-493, D-302): the host's payment gate refuses this e-mail. The password was right, but
        // the fresh session belongs to a community this identity cannot enter, so it is signed out here
        // and the person reads the same one-sentence notice as every other refusal.
        signOutLocally = true;
        target = `${state}&erro=nao-liberado`;
      } else if (res.status === 409 && apiError?.details?.reason === 'invite_pending') {
        target = '/aceitar-convite';
      } else if (res.status === 403 && apiError?.code === 'TENANT_SUSPENDED') {
        signOutLocally = true; // Same reason as the block.
        target = '/auth/suspended';
      } else if (res.status === 403 && apiError?.code === 'FORBIDDEN') {
        // A platform account (D-316) or a removed membership: the fresh session belongs to an origin
        // where this identity has no membership, so it is signed out here (T-08.1-16).
        signOutLocally = true;
        target = `${state}&erro=recusado`;
      } else if (res.status === 400 && apiError?.details?.consents === 'stale') {
        target = `${state}&erro=consentimento`;
      } else if (res.status === 503 && heldOfCode(apiError?.code)) {
        // 09.2-21: the community was put on hold between the page and the join. Nothing was decided
        // about this person, so the session is kept (no `signOutLocally`).
        target = heldPath(heldOfCode(apiError?.code) ?? 'unavailable');
      } else {
        target = `${state}&erro=falha`;
      }
    }
  } catch {
    target = `${state}&erro=falha`;
  }

  if (signOutLocally) {
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
    if (signOutError) console.error('signup.join_signout_failed', { error: String(signOutError) });
  }

  redirect(target);
}
