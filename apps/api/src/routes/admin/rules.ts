import { createRoute } from '@hono/zod-openapi';
import {
  adminRulesSchema,
  apiErrorEnvelopeSchema,
  RULES_ISSUES,
  type RulesIssue,
  rulesBodySchema,
} from '@rede-social/contracts';
import { KERNEL_PERMISSIONS } from '@rede-social/contracts/moderation';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requirePermission } from '@rede-social/core/server/rbac/permissions';
import { getTenantRules, saveTenantRules } from '@rede-social/core/server/tenancy/rules';
import type { ZodError } from 'zod';
import { createOpenApiApp, platformDefaultHook } from '../../http/openapi';

/**
 * `/v1/admin/rules` (ADMIN-03, D-341, UI-D-280, T-08-36/37) — the admin reads and rewrites the
 * community rules new members accept at sign-up.
 *
 * TENANT OF RECORD ONLY: `requireAuth` makes `ctx.tenantId` the caller's membership, and the kernel
 * (`tenancy/rules.ts`) scopes its admin-lane statements by `id = ctx.tenantId`; no path, query or body
 * value names a tenant (the body is strict). A session on another tenant's host is 403
 * `TENANT_HOST_MISMATCH` before any of this runs.
 *
 * `tenant.manage` on both routes (D-338: a permission, never a role); support and member get 403.
 *
 * The body is normalised before it is checked (LF line breaks, trimmed), and a refusal about the text
 * answers `details.rulesText` (`required` for empty or whitespace only, `too_long` above 10,000 UTF-16
 * code units) instead of the generic issue list, so the editor can say which. Saving identical text
 * keeps the version (D-341); a real change raises it by one and applies to new sign-ups only. Every
 * answer is `no-store`.
 */
const rules = createOpenApiApp();
rules.use('*', requireAuth);

const envelope = (description: string) => ({
  description,
  content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
});

const guard = requirePermission(KERNEL_PERMISSIONS.tenantManage);

/** Maps a refusal that is ONLY about the text to `{ rulesText }`; anything else is the shared hook. */
const rulesHook = (result: { success: boolean; error?: ZodError }): undefined => {
  if (result.success) return undefined;
  const issues = result.error?.issues ?? [];
  const onText = issues.filter(
    (issue) =>
      issue.path[0] === 'rulesText' && (RULES_ISSUES as readonly string[]).includes(issue.message),
  );
  if (onText.length > 0 && onText.length === issues.length) {
    const reason: RulesIssue = onText.some((issue) => issue.message === 'too_long')
      ? 'too_long'
      : 'required';
    throw new ApiError(400, 'VALIDATION_FAILED', { rulesText: reason });
  }
  platformDefaultHook(result);
  return undefined;
};

const getRoute = createRoute({
  method: 'get',
  path: '/',
  middleware: [guard] as const,
  responses: {
    200: {
      description: "The caller's tenant's rules text and the version new consents must present",
      content: { 'application/json': { schema: adminRulesSchema } },
    },
    403: envelope('FORBIDDEN — the caller does not hold `tenant.manage` in this tenant'),
  },
});

const putRoute = createRoute({
  method: 'put',
  path: '/',
  middleware: [guard] as const,
  request: {
    body: {
      content: { 'application/json': { schema: rulesBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description:
        'The rules in force after the save. `rulesVersion` is one higher when the normalised text changed and unchanged when it did not (D-341); no recorded consent changes either way',
      content: { 'application/json': { schema: adminRulesSchema } },
    },
    400: envelope(
      'VALIDATION_FAILED — `{ rulesText: "required" }` (empty or whitespace only), `{ rulesText: "too_long" }` (over 10,000 UTF-16 code units after normalisation), or the issue list for any other key',
    ),
    403: envelope('FORBIDDEN — the caller does not hold `tenant.manage` in this tenant'),
  },
});

export const adminRulesRoutes = rules
  .openapi(getRoute, async (c) => {
    const body = await getTenantRules(c.get('ctx'));
    c.header('Cache-Control', 'no-store');
    return c.json(body, 200);
  })
  .openapi(
    putRoute,
    async (c) => {
      const { rulesText } = c.req.valid('json');
      const saved = await saveTenantRules(c.get('ctx'), rulesText);
      c.header('Cache-Control', 'no-store');
      return c.json({ rulesText: saved.rulesText, rulesVersion: saved.rulesVersion }, 200);
    },
    rulesHook,
  );
