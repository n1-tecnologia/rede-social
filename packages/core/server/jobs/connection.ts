/**
 * The connection string pg-boss (node-postgres) is handed.
 *
 * The same `DATABASE_URL` feeds postgres.js (the request path) and node-postgres (pg-boss), and the
 * two read `sslmode=require` differently: postgres.js encrypts without verifying the chain (libpq
 * semantics), while node-postgres treats `require` as `verify-full` and fails on Supabase's pooler
 * with SELF_SIGNED_CERT_IN_CHAIN. `uselibpqcompat=true` restores libpq semantics for node-postgres
 * only. It is added here, not in the URL, because postgres.js would forward an unknown query
 * parameter to the server as a runtime setting.
 *
 * Anything other than a bare `sslmode=require` (no sslmode, `disable`, `verify-full`, or an explicit
 * `uselibpqcompat`) is returned unchanged.
 */
export function bossConnectionString(connectionString: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return connectionString;
  }
  if (url.searchParams.get('sslmode') !== 'require' || url.searchParams.has('uselibpqcompat')) {
    return connectionString;
  }
  url.searchParams.set('uselibpqcompat', 'true');
  return url.toString();
}
