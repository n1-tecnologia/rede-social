import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../server/env';
import * as schema from './schema';

/**
 * `api_user` through the transaction pooler: `prepare: false` (prepared statements are unsupported in
 * transaction mode) and a small pool so autoscaled instances stay bounded.
 * Request handlers never use `db` directly — they go through `withTenantTx` / `withAdminTx`.
 */
export const sqlClient = postgres(env.DATABASE_URL, { prepare: false, max: 5 });
export const db = drizzle(sqlClient, { schema });
