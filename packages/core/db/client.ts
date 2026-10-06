import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../server/env';
import * as schema from './schema';

/**
 * `api_user` through the transaction pooler: `prepare: false` (prepared statements are unsupported in
 * transaction mode) and a small pool so autoscaled instances stay bounded: `DATABASE_POOL_MAX`, 5 by
 * default (the api) and 10 on the worker (quick 261006-fs9; docs/DEPLOY.md "Connection budget (Pro)").
 * Request handlers never use `db` directly — they go through `withTenantTx` / `withAdminTx`.
 */
export const sqlClient = postgres(env.DATABASE_URL, { prepare: false, max: env.DATABASE_POOL_MAX });
export const db = drizzle(sqlClient, { schema });
