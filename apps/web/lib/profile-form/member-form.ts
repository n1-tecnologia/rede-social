import { type MemberForm, memberFormSchema } from '@rede-social/contracts/profile-form';
import { apiFetch } from '@/lib/api';
import { ApiClientError } from '@/lib/bootstrap';

/**
 * The member screens' reader of the profile form (12-12, D-582): `GET /v1/me/profile-form` is ONE read
 * for the first answer, the return after a form change and a later edit, and the API decides the mode
 * (`none`, `first`, `returning`, `edit`) from the data, never the URL. Read per request (`apiFetch` is
 * `no-store`). Throws `ApiClientError` on any non-2xx so the page can tell a session refusal from a
 * failed read; a body that does not match the contract throws too (it renders the failure state).
 */
export async function getMemberForm(): Promise<MemberForm> {
  const res = await apiFetch('/v1/me/profile-form');
  if (!res.ok) {
    let code = 'HTTP_ERROR';
    let requestId: string | undefined;
    try {
      const body = (await res.json()) as { error?: { code?: unknown; requestId?: unknown } };
      if (typeof body?.error?.code === 'string') code = body.error.code;
      if (typeof body?.error?.requestId === 'string') requestId = body.error.requestId;
    } catch {
      // A non-JSON body keeps the generic code.
    }
    throw new ApiClientError(res.status, code, undefined, requestId);
  }
  return memberFormSchema.parse(await res.json());
}
