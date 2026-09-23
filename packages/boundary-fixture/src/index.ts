/**
 * MOD-02 negative fixture. Every import below is a boundary violation, one per layer, so that
 * `pnpm boundaries:negative` fails loudly the day a layer stops enforcing:
 *
 *   1. `@tria/core/db/admin-tx`            — the admin lane is kernel-only (Biome noRestrictedImports,
 *                                            the rule that protects `service_role` from module code)
 *   1b. `withAdminTx` via `@tria/core/db/tenant-tx`
 *                                          — the SAME lane through the unrestricted public entry point.
 *                                            `tenant-tx` must not export it at all (phase-1 review
 *                                            CR-03): this import is a typecheck error today, and it
 *                                            is here so that a re-export creeping back into
 *                                            `tenant-tx.ts` shows up as a boundary that Biome cannot
 *                                            see — the reviewer of this file is the last line
 *   1c. `@tria/core/db` (raw `db` / `sqlClient`)
 *                                          — a module may only reach data through `withTenantTx`;
 *                                            with the raw client it could `set_config('role', …)`
 *                                            itself and the lane guard's regex would never match
 *   2. `@tria/module-feed/server/service`   — another module's INTERNALS, not its published entry
 *                                            point (`@tria/module-feed/server`); also absent from
 *                                            that package's `exports`, so it does not even resolve.
 *                                            04-10 repointed this from the throwaway reference
 *                                            module it deleted (D-19) at the feed: the fixture must
 *                                            keep violating, so the case MOVES rather than goes
 *   3. `@tria/api/types`                   — an `app`-tagged package; `turbo boundaries` forbids a
 *                                            `module` from depending on an `app`
 *
 * Nothing imports this file. It is never built, typechecked or executed — the point is that the
 * LINTERS refuse it.
 */

// @ts-nocheck -- this file is a lint fixture; it is not meant to typecheck or resolve.
import type { AppType } from '@tria/api/types';
import { db } from '@tria/core/db';
import { withAdminTx } from '@tria/core/db/admin-tx';
import { withAdminTx as leakedAdminTx } from '@tria/core/db/tenant-tx';
import { listFeed } from '@tria/module-feed/server/service';

export const violations = { withAdminTx, leakedAdminTx, db, listFeed };
export type FixtureAppType = AppType;
