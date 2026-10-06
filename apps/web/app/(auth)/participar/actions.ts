'use server';

import type { ApiErrorEnvelope } from '@rede-social/contracts';
import { joinFormSchema } from '@rede-social/contracts/join';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { createClient } from '@/lib/supabase/server';

/** Zod paths of the form -> the `?campos=` tokens `/participar` whitelists (T-02-49 rule). */
function fieldToken(path: readonly PropertyKey[]): string {
  const [head, leaf] = path.map(String);
  if (head === 'consents') return leaf === 'tenantRulesVersion' ? 'rulesVersion' : 'termsVersion';
  return head ?? 'form';
}

async function readError(res: Response): Promise<ApiErrorEnvelope['error'] | null> {
  try {
    const body = (await res.json()) as Partial<ApiErrorEnvelope>;
    return body?.error && typeof body.error.code === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

/**
 * "Participar" (08.1, D-305, D-306, D-311): the session ALREADY holds this origin's identity (the
 * password was proven on `/entrar`), so the action only validates the form and posts the join; the API
 * writes the membership, the typed name and both consents in one admin-lane transaction, and the host
 * decides the community (no slug is sent from a tenant host).
 *
 * Every target is computed first and `redirect()` is called outside the try/catch (Next 16 rule). The
 * name never reaches a URL; only whitelisted field tokens do.
 *
 * Blocked (D-304) and suspended (D-32) sign the session out HERE, locally, before redirecting
 * (WINDOWS #75, the 08.1-02 `joinFromSignup` fix): a server-action redirect reaches the `/auth/blocked`
 * and `/auth/suspended` route handlers through the router's fetch, so their own cookie clear never
 * reaches the browser and the session on this origin would survive the refusal.
 */
export async function join(formData: FormData): Promise<void> {
  const parsed = joinFormSchema.safeParse({
    name: String(formData.get('name') ?? ''),
    consents: {
      tenantRulesVersion: Number(formData.get('rulesVersion')),
      platformTermsVersion: Number(formData.get('termsVersion')),
    },
    // Unchecked boxes are absent from the FormData entirely; `z.literal(true)` then fails (AUTH-04).
    acceptRules: formData.get('acceptRules') === 'on',
    acceptTerms: formData.get('acceptTerms') === 'on',
  });
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => fieldToken(issue.path)))];
    redirect(`/participar?erro=validacao&campos=${encodeURIComponent(fields.join(','))}`);
  }

  const requestHeaders = await headers();
  const forwarded = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim();
  const clientIp = requestHeaders.get('x-real-ip') ?? forwarded ?? '';
  const userAgent = requestHeaders.get('user-agent') ?? '';

  let target: string;
  let signOutLocally = false;
  try {
    const res = await apiFetch('/v1/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(clientIp ? { 'X-Client-IP': clientIp } : {}),
        ...(userAgent ? { 'User-Agent': userAgent } : {}),
      },
      body: JSON.stringify({ name: parsed.data.name, consents: parsed.data.consents }),
    });
    if (res.ok) {
      target = '/inicio';
    } else if (res.status === 401) {
      target = '/entrar';
    } else {
      const error = await readError(res);
      if (res.status === 403 && error?.code === 'MEMBERSHIP_BLOCKED') {
        signOutLocally = true;
        target = `/auth/blocked?t=${encodeURIComponent(String(error.details?.tenantName ?? ''))}`;
      } else if (res.status === 403 && error?.code === 'TENANT_SUSPENDED') {
        signOutLocally = true; // Same reason as the block.
        target = '/auth/suspended';
      } else if (res.status === 409 && error?.details?.reason === 'invite_pending') {
        target = '/aceitar-convite';
      } else if (res.status === 400 && error?.details?.consents === 'stale') {
        target = '/participar?erro=consentimento';
      } else if (res.status === 403 && error?.code === 'FORBIDDEN') {
        target = '/participar?erro=recusado';
      } else {
        target = '/participar?erro=falha';
      }
    }
  } catch {
    target = '/participar?erro=falha';
  }

  if (signOutLocally) {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) console.error('join.refusal_signout_failed', { error: String(error) });
  }

  redirect(target);
}

/**
 * "Não participar" / "Sair" (D-305): signs out of THIS origin only (`scope: 'local'`), so a session the
 * same person holds on another community's address keeps working (T-08.1-10), then lands on `/entrar`.
 */
export async function declineJoin(): Promise<void> {
  let failed = false;
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
  } catch (error) {
    console.error('join.decline_failed', { error: String(error) });
    failed = true;
  }
  redirect(failed ? '/participar?erro=falha' : '/entrar');
}
