import { PHONE_MENU_ISSUES, type PhoneMenu, type PhoneMenuIssue } from '@rede-social/contracts';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * The phone menu kept in the tenant's brand (12.3-16, D-697): `PUT /v1/admin/branding/phone-menu`
 * saves the three lists, `DELETE` forgets them (the shell's own menu again). Both are `tenant.manage`
 * routes of the caller's own tenant, which the API takes from the membership, never from the request.
 *
 * The API owns the rules and refuses a menu that breaks one as a 400 whose `details.phoneMenu` is one
 * of `PHONE_MENU_ISSUES`; a malformed body is a plain 400 and is the generic failure here. Session
 * refusals the app knows become a navigation (the caller performs it: `redirect()` throws), a lost
 * permission leaves for Configurações with its toast, as Marca's actions do. Logging is shape only.
 */

export type PhoneMenuOutcome =
  | { status: 'ok' }
  | { status: 'rules'; issue: PhoneMenuIssue }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

const FORBIDDEN_PATH = '/configuracoes?erro=sem-permissao';
const PATH = '/v1/admin/branding/phone-menu';
const ISSUES: ReadonlySet<string> = new Set(PHONE_MENU_ISSUES);

async function answer(res: Response, op: string): Promise<PhoneMenuOutcome> {
  if (res.ok) return { status: 'ok' };
  let code = 'HTTP_ERROR';
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; details?: Record<string, unknown> };
    };
    if (typeof body?.error?.code === 'string') code = body.error.code;
    details = body?.error?.details;
  } catch {
    // A non-JSON body keeps the generic code.
  }
  const issue = details?.phoneMenu;
  if (res.status === 400 && typeof issue === 'string' && ISSUES.has(issue)) {
    return { status: 'rules', issue: issue as PhoneMenuIssue };
  }
  if (res.status === 401 || res.status === 403) {
    const path = bootstrapRedirectPath(new ApiClientError(res.status, code, details));
    if (path) return { status: 'redirect', path };
    if (res.status === 403 && code === 'FORBIDDEN')
      return { status: 'redirect', path: FORBIDDEN_PATH };
  }
  console.error(`admin.phone_menu.${op}_failed`, { status: res.status, code });
  return { status: 'error' };
}

/** `PUT /v1/admin/branding/phone-menu`: the whole menu replaces the saved one. */
export async function savePhoneMenu(menu: PhoneMenu): Promise<PhoneMenuOutcome> {
  try {
    return await answer(
      await apiFetch(PATH, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(menu),
      }),
      'save',
    );
  } catch (error) {
    console.error('admin.phone_menu.save_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/** `DELETE /v1/admin/branding/phone-menu`: forgets the saved menu; idempotent on the server. */
export async function clearPhoneMenu(): Promise<PhoneMenuOutcome> {
  try {
    return await answer(await apiFetch(PATH, { method: 'DELETE' }), 'clear');
  } catch (error) {
    console.error('admin.phone_menu.clear_failed', { error: String(error) });
    return { status: 'error' };
  }
}
