import { describe, expect, it } from 'vitest';

/**
 * CR-02 of the phase-1 review: GoTrue's OWN public sign-up must be closed.
 *
 * `POST {SUPABASE_URL}/auth/v1/signup` is reachable by anyone holding the publishable key that ships
 * in the browser bundle. With `[auth] enable_signup = true` it would mint an identity that skips the
 * API's tenant + consent flow (AUTH-01/AUTH-04) and, because `auth.users.email` is global, let an
 * attacker squat a victim's e-mail so the real person is `409 EMAIL_ALREADY_REGISTERED` forever.
 *
 * `supabase/config.toml` sets `enable_signup = false` in both `[auth]` and `[auth.email]`. This test
 * pins that against the RUNNING local stack (the setting is only live after the auth container is
 * (re)started with the file), while `signup.test.ts` proves `admin.createUser` — the API's path —
 * still works with the flag off.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (see scripts/local-env.sh)`);
  return value;
}

describe('GoTrue public sign-up is disabled (CR-02)', () => {
  it('POST /auth/v1/signup with the publishable key is refused with a 4xx and creates nothing', async () => {
    const email = `gotrue-signup-${Date.now()}@should-not-exist.local`;
    const res = await fetch(`${required('SUPABASE_URL')}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: required('SUPABASE_PUBLISHABLE_KEY'),
      },
      body: JSON.stringify({ email, password: 'Segredo123' }),
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const body = (await res.json()) as { error_code?: string; msg?: string; code?: string };
    // GoTrue's shape for a closed instance: `signup_disabled` / "Signups not allowed for this instance".
    expect(`${body.error_code ?? body.code ?? ''} ${body.msg ?? ''}`.toLowerCase()).toMatch(
      /signup_disabled|signups not allowed/,
    );
  });
});
