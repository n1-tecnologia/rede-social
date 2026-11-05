import { randomUUID } from 'node:crypto';
import type { CredentialStore } from '../../server/apps/credentials';
import {
  type AppPatch,
  type AppRow,
  type AppStore,
  emptyAppRow,
  type TenantFacts,
} from '../../server/apps/tenant-app';
import { ApiError } from '../../server/http/api-error';

/**
 * In-memory stand-ins for the two stores of the `apps` kernel module (13-09), so the unit tests exercise the
 * module's own rules with no database. The real stores are proved against the local stack in
 * `apps/api/tests/integration/platform-apps.test.ts`.
 */
export function memoryCredentialStore() {
  const rows = new Map<string, { id: string; sealed: string; heldAt: Date }>();
  const calls = { upsert: 0 };
  const store: CredentialStore = {
    async upsertSealed(tenantId, kind, build) {
      calls.upsert += 1;
      const key = `${tenantId}:${kind}`;
      const id = rows.get(key)?.id ?? randomUUID();
      const next = { id, sealed: build(id), heldAt: new Date() };
      rows.set(key, next);
      return { id, heldAt: next.heldAt };
    },
    async readSealed(tenantId, kind) {
      const row = rows.get(`${tenantId}:${kind}`);
      return row ? { id: row.id, sealed: row.sealed } : null;
    },
    async held(tenantId) {
      return [...rows.entries()]
        .filter(([key]) => key.startsWith(`${tenantId}:`))
        .map(([key, row]) => ({ kind: key.slice(tenantId.length + 1), heldAt: row.heldAt }));
    },
  };
  return { store, rows, calls };
}

export function memoryAppStore(
  tenants: Record<string, TenantFacts>,
  initial: Record<string, AppRow> = {},
) {
  const rows = new Map<string, AppRow>(Object.entries(initial));
  const store: AppStore = {
    async facts(tenantId) {
      return tenants[tenantId] ?? null;
    },
    async read(tenantId) {
      return rows.get(tenantId) ?? null;
    },
    async write(tenantId, change) {
      if (!tenants[tenantId]) throw new ApiError(404, 'NOT_FOUND');
      const current = rows.get(tenantId) ?? emptyAppRow(tenantId);
      const patch: AppPatch = change(current);
      rows.set(tenantId, { ...current, ...patch });
    },
  };
  return { store, rows };
}
