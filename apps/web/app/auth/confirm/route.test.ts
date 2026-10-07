import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `/auth/confirm` failure routing (02-REVIEW IN-03, fixed in 08-08): a link aimed at the invite
 * landing lands on `/convite-expirado` when it no longer exchanges, whatever its OTP `type`, and
 * every other failed link keeps the "ask for a fresh link" fallback. `redirect` throws in Next, so
 * the stub throws the destination and each case reads it.
 */
const verifyOtp = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { verifyOtp } }),
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

import { GET } from './route';

async function destination(query: string): Promise<string> {
  try {
    await GET(new NextRequest(`http://rede-demo.localhost:3000/auth/confirm?${query}`));
  } catch (error) {
    const message = String((error as Error).message);
    if (message.startsWith('REDIRECT:')) return message.slice('REDIRECT:'.length);
    throw error;
  }
  throw new Error('no redirect');
}

afterEach(() => {
  verifyOtp.mockReset();
  setCookie.mockReset();
});

describe('/auth/confirm — where a failed link lands', () => {
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
