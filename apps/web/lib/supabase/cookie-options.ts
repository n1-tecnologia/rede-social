import type { CookieOptionsWithName } from '@supabase/ssr';

/**
 * Session cookie policy (AUTH-02, T-02-01). `@supabase/ssr` defaults to `httpOnly: false` so a browser
 * client could read the session; this app never runs a browser Supabase client (data goes through the
 * API, Realtime gets its token from the BFF), so the `sb-*` cookies are HttpOnly + SameSite=Lax and
 * `Secure` on production builds (local dev serves plain http on `*.localhost`).
 */
export const sessionCookieOptions: CookieOptionsWithName = {
  path: '/',
  sameSite: 'lax',
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
};
