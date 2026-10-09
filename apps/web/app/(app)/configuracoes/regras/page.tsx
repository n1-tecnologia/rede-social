import { KERNEL_PERMISSIONS } from '@rede-social/contracts/moderation';
import { type AdminRules, adminRulesSchema } from '@rede-social/contracts/rules';
import { PageHeader } from '@rede-social/ui';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath, requireBootstrap } from '@/lib/bootstrap';
import { getHostTenant } from '@/lib/tenant-host';
import { saveRulesAction } from './actions';
import { RulesEditor } from './RulesEditor';

/**
 * `GET /v1/admin/rules`, mapped like every admin loader (UI-D-284): session and membership refusals
 * follow the shipped `(app)` navigation, a 403 `FORBIDDEN` (the permission was lost since the
 * bootstrap was read) is `notFound()`, and anything else is a real render error. `redirect` and
 * `notFound` throw, so both sit OUTSIDE the try/catch (Next 16).
 */
async function loadAdminRules(): Promise<AdminRules> {
  let path: string | null = null;
  let forbidden = false;
  let failure: unknown = null;
  try {
    const res = await apiFetch('/v1/admin/rules');
    if (res.ok) return adminRulesSchema.parse(await res.json());
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
    failure = new ApiClientError(res.status, code, details);
  } catch (error) {
    failure = error;
  }
  if (failure instanceof ApiClientError) {
    path = bootstrapRedirectPath(failure);
    forbidden = failure.status === 403 && failure.code === 'FORBIDDEN';
  }
  if (path) redirect(path);
  if (forbidden) notFound();
  throw failure;
}

/**
 * `/configuracoes/regras` (ADMIN-03, D-339, D-341, UI-D-270, UI-D-280) — the admin writes the rules
 * that new members read and accept at sign-up, previews them exactly as `/cadastro` shows them, and
 * saves a new version only when the text changed. Existing members are not asked again (D-341).
 *
 * **`notFound()`, never a 403 screen** (UI-D-270): without `tenant.manage` in `bootstrap.permissions`
 * — the SAME composed value the API's `requirePermission` reads — and on the platform host. No cache
 * directive: the rules and the version are read per request.
 *
 * The editor is keyed on the version in force, so a refresh after a save (or another admin's save)
 * starts from the stored text rather than a stale draft baseline.
 */
export default async function AdminRulesPage() {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') notFound();

  const bootstrap = await requireBootstrap();
  if (!bootstrap.permissions.includes(KERNEL_PERMISSIONS.tenantManage)) notFound();

  const [t, rules] = await Promise.all([getTranslations('admin'), loadAdminRules()]);
  const tenantName = bootstrap.tenant.displayName;

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
      <PageHeader
        title={t('rules.title')}
        backHref="/configuracoes"
        backLabel={t('back')}
        className="md:static md:px-0"
      />
      <RulesEditor
        key={rules.rulesVersion}
        tenantName={tenantName}
        initialText={rules.rulesText}
        initialVersion={rules.rulesVersion}
        action={saveRulesAction}
      />
    </div>
  );
}
