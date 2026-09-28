import type { ModuleKey } from '@rede-social/contracts';
import { eq } from 'drizzle-orm';
import { tenantModules } from '../../db/schema';
import { withTenantTx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';

/** Everything the tenant lane needs; the cache never sees (or stores) anything else about the user. */
export type FlagsContext = Pick<RequestContext, 'userId' | 'tenantId' | 'role'>;

export type TenantFlags = {
  keys: Set<ModuleKey>;
  settings: Map<ModuleKey, Record<string, unknown>>;
};

type Entry = TenantFlags & { expiresAt: number };

/** One row per ENABLED module of the tenant, as the loader returns it. */
export type FlagRow = { moduleKey: string; settings: Record<string, unknown> };
export type FlagsLoader = (ctx: FlagsContext) => Promise<FlagRow[]>;

export const MODULE_FLAGS_TTL_MS = 30_000;

/** RLS-scoped read: the tenant lane can only ever see its own rows, so no `where tenant_id` is needed. */
const defaultLoader: FlagsLoader = (ctx) =>
  withTenantTx(ctx, async (tx) =>
    tx
      .select({ moduleKey: tenantModules.moduleKey, settings: tenantModules.settings })
      .from(tenantModules)
      .where(eq(tenantModules.enabled, true)),
  );

export type ModuleFlagsOptions = {
  loader?: FlagsLoader;
  now?: () => number;
  ttlMs?: number;
};

/**
 * Per-instance flags cache, keyed by TENANT ID with a 30 s TTL (D-16 discretion, ARCHITECTURE
 * §Pattern 3). A flag flipped in the database is visible within the TTL on every instance without a
 * redeploy; `invalidate(tenantId)` makes it immediate on the local one.
 *
 * It caches `tenant_modules` and NOTHING else. Membership status is deliberately absent (RESEARCH
 * §Anti-Patterns, D-09): a block must take effect on the very next request, so `requireAuth` always
 * re-reads the membership row. Entries are per tenant, so tenant A's refresh can never serve B.
 */
export function createModuleFlags(options: ModuleFlagsOptions = {}) {
  const load = options.loader ?? defaultLoader;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? MODULE_FLAGS_TTL_MS;
  const cache = new Map<string, Entry>();

  async function read(ctx: FlagsContext): Promise<TenantFlags> {
    const at = now();
    const hit = cache.get(ctx.tenantId);
    if (hit && hit.expiresAt > at) return hit;

    const rows = await load(ctx);
    const keys = new Set<ModuleKey>();
    const settings = new Map<ModuleKey, Record<string, unknown>>();
    for (const row of rows) {
      const key = row.moduleKey as ModuleKey;
      keys.add(key);
      settings.set(key, row.settings ?? {});
    }
    cache.set(ctx.tenantId, { keys, settings, expiresAt: at + ttlMs });
    return { keys, settings };
  }

  return {
    ttlMs,
    /** Enabled keys for `ctx.tenantId`. A missing row is simply not in the set. */
    async enabledKeys(ctx: FlagsContext): Promise<Set<ModuleKey>> {
      return (await read(ctx)).keys;
    },
    /** Enabled keys plus each one's `settings` blob (the bootstrap handler needs both). */
    flags: read,
    async isEnabled(ctx: FlagsContext, key: ModuleKey): Promise<boolean> {
      return (await read(ctx)).keys.has(key);
    },
    /** Drops one tenant's entry on THIS instance (used by the Phase 2 toggle route and by tests). */
    invalidate(tenantId: string): void {
      cache.delete(tenantId);
    },
  };
}

export type ModuleFlags = ReturnType<typeof createModuleFlags>;

/** The process-wide instance every guard and route uses. */
export const moduleFlags: ModuleFlags = createModuleFlags();
