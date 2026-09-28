'use server';

import { inviteParamsSchema, tenantInviteSchema } from '@rede-social/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ApiClientError } from '@/lib/bootstrap';
import { platformRedirectPath } from '@/lib/platform';

/** What `resendInviteAction` hands back to the button — a state and a stable code, never copy. */
export type ResendInviteResult =
  | { ok: true; status: 'pending' | 'sent' | 'accepted' | 'expired'; sentAt: string | null }
  | { ok: false; code: string; reason?: string };

/**
 * "Reenviar convite" (D-30): `POST /v1/platform/tenants/{id}/invites/{inviteId}/resend`, mirroring
 * `setTenantStatusAction`. Both ids are validated with the API's own `inviteParamsSchema` before the
 * request; on success the tenant layout is revalidated so the "Convite enviado em {date}" pill shows
 * the fresh `sentAt` on the same navigation. 401/403 navigate like every platform read (`redirect()`
 * after the try/catch — Next 16 rule); every other refusal is returned as its envelope code and the
 * client translates by key. Nothing from the response body is rendered raw.
 */
export async function resendInviteAction(
  tenantId: string,
  inviteId: string,
): Promise<ResendInviteResult> {
  const params = inviteParamsSchema.safeParse({ id: tenantId, inviteId });
  if (!params.success) return { ok: false, code: 'VALIDATION_FAILED' };

  let refusal: string | null = null;
  let outcome: ResendInviteResult;
  try {
    const res = await apiFetch(
      `/v1/platform/tenants/${encodeURIComponent(params.data.id)}/invites/${encodeURIComponent(
        params.data.inviteId,
      )}/resend`,
      { method: 'POST' },
    );
    if (res.ok) {
      const invite = tenantInviteSchema.parse(await res.json());
      revalidatePath(`/plataforma/tenants/${params.data.id}`, 'layout');
      outcome = { ok: true, status: invite.status, sentAt: invite.sentAt };
    } else {
      const envelope = (await res.json().catch(() => null)) as {
        error?: { code?: string; details?: Record<string, unknown>; requestId?: string };
      } | null;
      const code = envelope?.error?.code ?? 'HTTP_ERROR';
      if (res.status === 401 || res.status === 403) {
        refusal = platformRedirectPath(
          new ApiClientError(
            res.status,
            code,
            envelope?.error?.details,
            envelope?.error?.requestId,
          ),
        );
      }
      const reason = envelope?.error?.details?.reason;
      outcome = { ok: false, code, ...(reason ? { reason: String(reason) } : {}) };
    }
  } catch (error) {
    console.error('platform.invites.resend_failed', { error: String(error) });
    outcome = { ok: false, code: 'NETWORK_ERROR' };
  }

  if (refusal) redirect(refusal);
  return outcome;
}
