import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `/auth/confirm` failure routing (02-REVIEW IN-03, fixed in 08-08): a link aimed at the invite
 * landing lands on `/convite-expirado` when it no longer exchanges, whatever its OTP `type`, and
 * every other failed link keeps the "ask for a fresh link" fallback. `redirect` throws in Next, so
 * the stub throws the destination and each case reads it.
 */
const verifyOtp = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    createClient();
    return { auth: { verifyOtp } };
  },
}));

const setCookie = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({
  cookies: async () => ({ set: setCookie }),
}));

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { GET, POST } from './route';

const BASE = 'http://rede-demo.localhost:3000';

/** The GET hop: the redirect it throws (it must never touch Supabase). */
async function getDestination(query: string): Promise<string> {
  try {
    await GET(new NextRequest(`${BASE}/auth/confirm?${query}`));
  } catch (error) {
    const message = String((error as Error).message);
    if (message.startsWith('REDIRECT:')) return message.slice('REDIRECT:'.length);
    throw error;
  }
  throw new Error('no redirect');
}

/** A POST with the given hidden fields; returns the whole answer. */
async function post(query: string, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new NextRequest(`${BASE}/auth/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(query).toString(),
    }),
  );
}

/** The POST answer's relative Location, asserting the 303 contract. */
async function destination(query: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await post(query, headers);
  expect(res.status).toBe(303);
  const location = res.headers.get('location') ?? '';
  expect(location.startsWith('/')).toBe(true);
  expect(location).not.toContain('abc');
  return location;
}

afterEach(() => {
  createClient.mockReset();
  verifyOtp.mockReset();
  setCookie.mockReset();
});

describe('/auth/confirm GET: inert (SafeLinks fix, quick 261117-kkx)', () => {
  function untouched() {
    expect(createClient).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(setCookie).not.toHaveBeenCalled();
  }

  it('hands a valid-shaped link to the interstitial for each of the five types and consumes nothing', async () => {
    for (const type of ['recovery', 'email', 'signup', 'invite', 'magiclink']) {
      expect(await getDestination(`token_hash=abc&type=${type}&next=/redefinir-senha`)).toBe(
        `/auth/continuar?token_hash=abc&type=${type}&next=%2Fredefinir-senha`,
      );
    }
    expect(await getDestination('token_hash=abc&type=invite&next=/aceitar-convite')).toBe(
      '/auth/continuar?token_hash=abc&type=invite&next=%2Faceitar-convite',
    );
    untouched();
  });

  it('sanitises next in this hop and drops extra params', async () => {
    expect(await getDestination('token_hash=abc&type=recovery')).toBe(
      '/auth/continuar?token_hash=abc&type=recovery&next=%2Finicio',
    );
    expect(await getDestination('token_hash=abc&type=recovery&next=https://evil.example')).toBe(
      '/auth/continuar?token_hash=abc&type=recovery&next=%2Finicio',
    );
    expect(await getDestination('token_hash=abc&type=recovery&next=//evil.example&x=1')).toBe(
      '/auth/continuar?token_hash=abc&type=recovery&next=%2Finicio',
    );
    untouched();
  });

  it('keeps the old fallbacks for a link with no token or an unknown type, still without Supabase', async () => {
    expect(await getDestination('type=recovery&next=/redefinir-senha')).toBe(
      '/esqueci-senha?erro=link-invalido',
    );
    expect(await getDestination('token_hash=abc&type=nonsense')).toBe(
      '/esqueci-senha?erro=link-invalido',
    );
    expect(await getDestination('type=signup&next=/inicio')).toBe(
      '/verifique-seu-email?erro=link-invalido',
    );
    expect(await getDestination('type=recovery&next=/aceitar-convite')).toBe('/convite-expirado');
    expect(await getDestination('type=invite')).toBe('/convite-expirado');
    untouched();
  });
});

describe('/auth/confirm POST: consumes the token — where a failed link lands', () => {
  it('IN-03: a lapsed recovery-type invite link (next=/aceitar-convite) lands on /convite-expirado', async () => {
    verifyOtp.mockResolvedValue({ error: new Error('otp_expired') });
    expect(await destination('token_hash=abc&type=recovery&next=/aceitar-convite')).toBe(
      '/convite-expirado',
    );
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'abc' });
  });

  it('an invite-type link that fails lands on /convite-expirado, as before', async () => {
    verifyOtp.mockResolvedValue({ error: new Error('otp_expired') });
    expect(await destination('token_hash=abc&type=invite&next=/aceitar-convite')).toBe(
      '/convite-expirado',
    );
  });

  it('a lapsed password-recovery link still asks for a fresh link', async () => {
    verifyOtp.mockResolvedValue({ error: new Error('otp_expired') });
    expect(await destination('token_hash=abc&type=recovery&next=/redefinir-senha')).toBe(
      '/esqueci-senha?erro=link-invalido',
    );
  });

  it('a foreign next that merely contains the invite path is not an invite', async () => {
    verifyOtp.mockResolvedValue({ error: new Error('otp_expired') });
    expect(
      await destination('token_hash=abc&type=recovery&next=//evil.example/aceitar-convite'),
    ).toBe('/esqueci-senha?erro=link-invalido');
    expect(await destination('token_hash=abc&type=recovery&next=/aceitar-convite-x')).toBe(
      '/esqueci-senha?erro=link-invalido',
    );
  });

  it('quick 261007-gbk: a failed signup-type exchange lands on /verifique-seu-email?erro=link-invalido', async () => {
    verifyOtp.mockResolvedValue({ error: new Error('otp_expired') });
    expect(await destination('token_hash=abc&type=signup&next=/inicio')).toBe(
      '/verifique-seu-email?erro=link-invalido',
    );
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'signup', token_hash: 'abc' });
    // The open-redirect guard does not matter for a failure: the destination is fixed.
    expect(await destination('token_hash=abc&type=signup&next=https://evil.example')).toBe(
      '/verifique-seu-email?erro=link-invalido',
    );
  });

  it('a successful signup exchange lands on next', async () => {
    verifyOtp.mockResolvedValue({ error: null });
    expect(await destination('token_hash=abc&type=signup&next=/inicio')).toBe('/inicio');
  });

  it('a successful exchange still lands on next', async () => {
    verifyOtp.mockResolvedValue({ error: null });
    expect(await destination('token_hash=abc&type=recovery&next=/aceitar-convite')).toBe(
      '/aceitar-convite',
    );
  });
});

describe('/auth/confirm POST: hardening and the cross-site guard', () => {
  it('re-applies the open-redirect guard to the hidden next field', async () => {
    verifyOtp.mockResolvedValue({ error: null });
    for (const next of ['//evil.example', '/\\evil.example', 'https://evil.example']) {
      const params = new URLSearchParams({ token_hash: 'abc', type: 'recovery', next });
      expect(await destination(params.toString())).toBe('/inicio');
    }
  });

  it('never reaches verifyOtp with an unknown type or an empty token', async () => {
    expect(await destination('token_hash=abc&type=nonsense&next=/inicio')).toBe(
      '/esqueci-senha?erro=link-invalido',
    );
    expect(await destination('token_hash=&type=signup&next=/inicio')).toBe(
      '/verifique-seu-email?erro=link-invalido',
    );
    expect(createClient).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('a body that is not form data lands on the fallback with no Supabase call', async () => {
    for (const body of ['', '{"token_hash":"abc"}']) {
      const res = await POST(
        new NextRequest(`${BASE}/auth/confirm`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: body || undefined,
        }),
      );
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/esqueci-senha?erro=link-invalido');
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  it('answers are not cacheable', async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const res = await post('token_hash=abc&type=recovery&next=/redefinir-senha');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses a cross-site POST with 403 before Supabase is touched', async () => {
    const crossSite: Record<string, string>[] = [
      { 'sec-fetch-site': 'cross-site' },
      { origin: 'https://evil.example' },
    ];
    for (const headers of crossSite) {
      const res = await post('token_hash=abc&type=recovery&next=/redefinir-senha', headers);
      expect(res.status).toBe(403);
    }
    expect(createClient).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(setCookie).not.toHaveBeenCalled();
  });

  it('accepts same-origin, Origin: null, no Origin, and an Origin equal to x-forwarded-host', async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const q = 'token_hash=abc&type=recovery&next=/redefinir-senha';
    const accepted: Record<string, string>[] = [
      { origin: BASE, 'sec-fetch-site': 'same-origin' },
      { origin: 'null' },
      {},
      { origin: 'https://social.example.com', 'x-forwarded-host': 'social.example.com, proxy' },
    ];
    for (const headers of accepted) {
      expect(await destination(q, headers)).toBe('/redefinir-senha');
    }
  });
});

describe('/auth/confirm: the allowlist refusal (quick 261018-owq)', () => {
  /** GoTrue's `AuthApiError` for the hook's 403: status + the exact sentinel message. */
  const notAllowed = () => Object.assign(new Error('EMAIL_NOT_ALLOWED'), { status: 403 });

  it('a signup, recovery or invite link refused by the hook lands on /entrar?erro=nao-liberado', async () => {
    verifyOtp.mockResolvedValue({ error: notAllowed() });
    expect(await destination('token_hash=abc&type=signup&next=/inicio')).toBe(
      '/entrar?erro=nao-liberado',
    );
    expect(await destination('token_hash=abc&type=recovery&next=/redefinir-senha')).toBe(
      '/entrar?erro=nao-liberado',
    );
    // The allowlist branch wins over the /convite-expirado fallback.
    expect(await destination('token_hash=abc&type=invite&next=/aceitar-convite')).toBe(
      '/entrar?erro=nao-liberado',
    );
    expect(setCookie).not.toHaveBeenCalled();
  });

  it('a 403 with another message, or the sentinel on another status, keeps the old destinations', async () => {
    verifyOtp.mockResolvedValue({ error: Object.assign(new Error('forbidden'), { status: 403 }) });
    expect(await destination('token_hash=abc&type=signup&next=/inicio')).toBe(
      '/verifique-seu-email?erro=link-invalido',
    );
    verifyOtp.mockResolvedValue({
      error: Object.assign(new Error('EMAIL_NOT_ALLOWED'), { status: 500 }),
    });
    expect(await destination('token_hash=abc&type=recovery&next=/redefinir-senha')).toBe(
      '/esqueci-senha?erro=link-invalido',
    );
  });

  it('an otp_expired error keeps every existing destination', async () => {
    verifyOtp.mockResolvedValue({
      error: Object.assign(new Error('otp_expired'), { status: 403 }),
    });
    expect(await destination('token_hash=abc&type=invite&next=/aceitar-convite')).toBe(
      '/convite-expirado',
    );
    expect(await destination('token_hash=abc&type=recovery&next=/redefinir-senha')).toBe(
      '/esqueci-senha?erro=link-invalido',
    );
  });
});

describe('/auth/confirm: the link-return marker (quick 261007-kyp)', () => {
  const MARKER_OPTIONS = expect.objectContaining({
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });

  it('a successful signup exchange writes link_return=signup and still lands on /inicio', async () => {
    verifyOtp.mockResolvedValue({ error: null });
    expect(await destination('token_hash=abc&type=signup&next=/inicio')).toBe('/inicio');
    expect(setCookie).toHaveBeenCalledTimes(1);
    expect(setCookie).toHaveBeenCalledWith('link_return', 'signup', MARKER_OPTIONS);
    expect(setCookie.mock.calls[0]?.[2]).not.toHaveProperty('domain');
  });

  it('a recovery exchange aimed at the password form writes link_return=recovery', async () => {
    verifyOtp.mockResolvedValue({ error: null });
    expect(await destination('token_hash=abc&type=recovery&next=/redefinir-senha')).toBe(
      '/redefinir-senha',
    );
    expect(setCookie).toHaveBeenCalledWith('link_return', 'recovery', MARKER_OPTIONS);
  });

  it('an invite exchange writes link_return=invite, for type=invite and for the recovery-type fallback', async () => {
    verifyOtp.mockResolvedValue({ error: null });
    await destination('token_hash=abc&type=recovery&next=/aceitar-convite');
    expect(setCookie).toHaveBeenLastCalledWith('link_return', 'invite', MARKER_OPTIONS);
    await destination('token_hash=abc&type=invite&next=/aceitar-convite');
    expect(setCookie).toHaveBeenLastCalledWith('link_return', 'invite', MARKER_OPTIONS);
  });

  it('every failed exchange writes nothing', async () => {
    verifyOtp.mockResolvedValue({ error: new Error('otp_expired') });
    await destination('token_hash=abc&type=recovery&next=/aceitar-convite');
    await destination('token_hash=abc&type=invite&next=/aceitar-convite');
    await destination('token_hash=abc&type=recovery&next=/redefinir-senha');
    await destination('token_hash=abc&type=signup&next=/inicio');
    expect(setCookie).not.toHaveBeenCalled();
  });

  it('a missing token_hash or an unknown type never writes', async () => {
    verifyOtp.mockResolvedValue({ error: null });
    await destination('type=signup&next=/inicio');
    await destination('token_hash=abc&type=nonsense&next=/inicio');
    expect(setCookie).not.toHaveBeenCalled();
  });
});
