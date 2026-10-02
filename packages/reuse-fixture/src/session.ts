/**
 * A real GoTrue session for a seeded user, for the fixture's database case only.
 *
 * A plain `fetch` against the local Auth password grant instead of `@supabase/supabase-js`, so the
 * fixture's dependency set stays the kernel contracts plus one module (MOD-05). Local stack only:
 * the URL, publishable key and seed password come from the same `apps/api/.env.local` (or CI
 * environment) the API integration suite reads.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required for the reuse fixture's DB case (see scripts/local-env.sh)`,
    );
  }
  return value;
}

/** Signs `email` in with `SEED_PASSWORD` and returns the access token the kernel verifies. */
export async function passwordSession(email: string): Promise<string> {
  const url = `${required('SUPABASE_URL')}/auth/v1/token?grant_type=password`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: required('SUPABASE_PUBLISHABLE_KEY'),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password: required('SEED_PASSWORD') }),
  });
  if (!res.ok) {
    throw new Error(`password grant failed for ${email}: ${res.status}`);
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error(`password grant for ${email} returned no access token`);
  return body.access_token;
}
