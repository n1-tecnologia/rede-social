import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KERNEL_PERMISSIONS } from '@rede-social/contracts/moderation';
import { KERNEL_ROLE_PERMISSIONS } from '@rede-social/core/server/rbac/require-role';
import { moderatorRoles } from '@rede-social/module-notifications/server';
import { describe, expect, it } from 'vitest';

/**
 * Phase 11 plan 17 (Open Question 1, T-11-32): the moderators' notice and the SQL that guards the reports must name
 * the SAME role. The audience of the `report.created` notice is DERIVED from `KERNEL_ROLE_PERMISSIONS`; the report
 * resolve definer and the `content_reports_select` policy keep the literal `admin_tenant` they check today. This
 * test fails the moment one side moves without the other, which is the pattern 07-08 used for the staff roles.
 *
 * The failure messages say which side to change. The "drift is detected" case proves the detector on a COPY of the
 * map held by this file, never by editing the real one.
 */

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const migration = (name: string): string =>
  readFileSync(join(REPO, 'supabase/migrations', name), 'utf8');

const SQL_ROLE = 'admin_tenant';

/** The roles of `map` that hold `moderation.manage`, the question both sides must answer alike. */
const holders = (map: Record<string, readonly string[]>): string[] =>
  Object.entries(map)
    .filter(([, granted]) => granted.includes(KERNEL_PERMISSIONS.moderationManage))
    .map(([role]) => role);

const drift = (map: Record<string, readonly string[]>): string | null => {
  const roles = holders(map);
  return roles.length === 1 && roles[0] === SQL_ROLE
    ? null
    : `KERNEL_ROLE_PERMISSIONS grants moderation.manage to [${roles.join(', ')}] but the SQL of the report resolve and the content_reports_select policy check only '${SQL_ROLE}': change the TypeScript map and the two SQL definitions in the same plan (a new migration redefining app.content_report_resolve and content_reports_select), and the audience of packages/modules/notifications/server/report-notice.ts follows the map on its own`;
};

describe('report notice audience drift (T-11-32)', () => {
  it('only admin_tenant holds moderation.manage in the kernel permission map', () => {
    const message = drift(KERNEL_ROLE_PERMISSIONS);
    expect(message, message ?? '').toBeNull();
    expect(holders(KERNEL_ROLE_PERMISSIONS)).toEqual(['admin_tenant']);
  });

  it('the notice derives its audience from that same map', () => {
    expect(moderatorRoles()).toEqual(holders(KERNEL_ROLE_PERMISSIONS));
  });

  it('the resolve definer and the select policy still spell admin_tenant', () => {
    const functions = migration('20261105152916_reports_blocks_functions.sql');
    const resolve = /create or replace function app\.content_report_resolve[\s\S]*?\$\$;/i.exec(
      functions,
    )?.[0];
    expect(resolve, 'app.content_report_resolve is defined in 20261105152916').toBeDefined();
    expect(
      resolve,
      `the resolve definer must still refuse every role but '${SQL_ROLE}': change it together with KERNEL_ROLE_PERMISSIONS`,
    ).toMatch(/app\.tenant_role\(\) is distinct from 'admin_tenant'/);

    const table = migration('20261105152832_reports_blocks.sql');
    const policy = /CREATE POLICY "content_reports_select"[^\n]*/.exec(table)?.[0];
    expect(policy, 'content_reports_select is defined in 20261105152832').toBeDefined();
    expect(
      policy,
      `the select policy must still admit only '${SQL_ROLE}' beside the reporter: change it together with KERNEL_ROLE_PERMISSIONS`,
    ).toMatch(/app\.tenant_role\(\) = 'admin_tenant'/);
  });

  it('drift is detected: a copy of the map that grants the permission to another role fails the check', () => {
    const copy: Record<string, string[]> = {
      ...Object.fromEntries(
        Object.entries(KERNEL_ROLE_PERMISSIONS).map(([role, granted]) => [role, [...granted]]),
      ),
    };
    expect(drift(copy)).toBeNull();
    copy.support_tenant = [...(copy.support_tenant ?? []), KERNEL_PERMISSIONS.moderationManage];
    expect(drift(copy)).toMatch(/change the TypeScript map and the two SQL definitions/);
    expect(holders(copy)).toEqual(['admin_tenant', 'support_tenant']);
    copy.admin_tenant = [];
    copy.support_tenant = [];
    expect(drift(copy)).not.toBeNull();
    // The real map was not touched by any of the above.
    expect(holders(KERNEL_ROLE_PERMISSIONS)).toEqual(['admin_tenant']);
  });
});
