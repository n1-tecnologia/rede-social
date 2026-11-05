import type { NativePlatform } from '@rede-social/contracts/native';
import type { SQL } from 'drizzle-orm';
import { ReleaseRefusal } from './report';

/**
 * What the command records in `platform.tenant_apps` AFTER a successful publish (13-29, UI-D-613, UI-D-621): the last
 * build per store, the minimum version per store and the store links. Only the fields passed are written, links
 * must be https, versions must be `x.y.z`. The floors reach installed apps within 60 seconds (13-10).
 */

export type BuildRecord = { version: string; buildNumber: number };

export type VersionPatch = {
  last?: Partial<Record<NativePlatform, BuildRecord>>;
  minVersion?: Partial<Record<NativePlatform, string>>;
  storeUrl?: Partial<Record<NativePlatform, string>>;
};

export type VersionStore = { write(tenantId: string, patch: VersionPatch): Promise<void> };

const VERSION = /^\d+\.\d+\.\d+$/;

/** Validates the whole patch before any store sees it. Throws `bad_arguments`. */
export function assertVersionPatch(patch: VersionPatch): void {
  const bad = () => new ReleaseRefusal('bad_arguments');
  for (const record of Object.values(patch.last ?? {})) {
    if (
      !VERSION.test(record.version) ||
      !Number.isInteger(record.buildNumber) ||
      record.buildNumber < 1
    ) {
      throw bad();
    }
  }
  for (const version of Object.values(patch.minVersion ?? {})) {
    if (!VERSION.test(version)) throw bad();
  }
  for (const raw of Object.values(patch.storeUrl ?? {})) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw bad();
    }
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      raw.length > 2048
    ) {
      throw bad();
    }
  }
}

/** The control plane, through the platform lane. The row is created by the first write if the tenant has none. */
export const pgVersionStore: VersionStore = {
  async write(tenantId, patch) {
    assertVersionPatch(patch);
    const { withPlatformTx } = await import('@rede-social/core/db/platform-tx');
    const { sql } = await import('drizzle-orm');
    const sets: SQL[] = [];
    for (const platform of ['ios', 'android'] as const) {
      const last = patch.last?.[platform];
      if (last) {
        sets.push(
          platform === 'ios'
            ? sql`last_ios_version = ${last.version}, last_ios_build = ${last.buildNumber}, last_ios_at = now()`
            : sql`last_android_version = ${last.version}, last_android_build = ${last.buildNumber}, last_android_at = now()`,
        );
      }
      const min = patch.minVersion?.[platform];
      if (min !== undefined) {
        sets.push(
          platform === 'ios' ? sql`min_version_ios = ${min}` : sql`min_version_android = ${min}`,
        );
      }
      const url = patch.storeUrl?.[platform];
      if (url !== undefined) {
        sets.push(
          platform === 'ios' ? sql`store_url_ios = ${url}` : sql`store_url_android = ${url}`,
        );
      }
    }
    if (sets.length === 0) return;
    await withPlatformTx(async (tx) => {
      await tx.execute(
        sql`insert into platform.tenant_apps (tenant_id) values (${tenantId}::uuid) on conflict (tenant_id) do nothing`,
      );
      await tx.execute(
        sql`update platform.tenant_apps set ${sql.join(sets, sql`, `)}, updated_at = now() where tenant_id = ${tenantId}::uuid`,
      );
    });
  },
};

/** In memory, for the dry run (nothing is persisted) and the unit tests. */
export function memoryVersionStore(): VersionStore & {
  patches: { tenantId: string; patch: VersionPatch }[];
} {
  const patches: { tenantId: string; patch: VersionPatch }[] = [];
  return {
    patches,
    async write(tenantId, patch) {
      assertVersionPatch(patch);
      patches.push({ tenantId, patch });
    },
  };
}
