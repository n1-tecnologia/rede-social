// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `/auth/continuar` (quick 261117-kkx): the interstitial a mail link lands on. Real pt-BR catalog;
 * the page must call nothing server-side (Supabase, cookies, headers), so each of those throws.
 */

const mocks = vi.hoisted(() => ({
  touched: [] as string[],
  verifyOtp: vi.fn(),
  setCookie: vi.fn(),
}));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { join } = await import('node:path');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});
vi.mock('next/headers', () => ({
  cookies: async () => {
    mocks.touched.push('cookies');
    return { set: mocks.setCookie };
  },
  headers: async () => {
    mocks.touched.push('headers');
    throw new Error('headers() must not be read');
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    mocks.touched.push('supabase');
    return { auth: { verifyOtp: mocks.verifyOtp } };
  },
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

const { default: Page } = await import('./page');
const { ConfirmForm } = await import('./ConfirmForm');
const { GET, POST } = await import('../../../auth/confirm/route');

afterEach(() => {
  cleanup();
  mocks.touched.length = 0;
  mocks.verifyOtp.mockReset();
  mocks.setCookie.mockReset();
});

type Query = Record<string, string | string[] | undefined>;

async function renderPage(query: Query) {
  return render(await Page({ searchParams: Promise.resolve(query) }));
}

function hidden(container: HTMLElement, name: string): string | null {
  return (
    container.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)?.value ?? null
  );
}

async function redirectOf(query: Query): Promise<string> {
  try {
    await Page({ searchParams: Promise.resolve(query) });
  } catch (error) {
    const message = String((error as Error).message);
    if (message.startsWith('REDIRECT:')) return message.slice('REDIRECT:'.length);
    throw error;
  }
  throw new Error('no redirect');
}

describe('/auth/continuar: the interstitial', () => {
  it('recovery: a native post form with three hidden fields and one button', async () => {
    const { container } = await renderPage({
      token_hash: 'abc',
      type: 'recovery',
      next: '/redefinir-senha',
    });
    expect(screen.getByRole('heading', { name: 'Redefinir senha' })).toBeTruthy();
    const form = container.querySelector('form');
    expect(form?.getAttribute('method')).toBe('post');
    expect(form?.getAttribute('action')).toBe('/auth/confirm');
    expect(hidden(container, 'token_hash')).toBe('abc');
    expect(hidden(container, 'type')).toBe('recovery');
    expect(hidden(container, 'next')).toBe('/redefinir-senha');
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe('Escolher nova senha');
    expect(buttons[0]?.getAttribute('type')).toBe('submit');
  });

  it('the button copy follows the link kind', async () => {
    const cases: [Query, string][] = [
      [{ token_hash: 'a', type: 'signup', next: '/inicio' }, 'Confirmar e-mail'],
      [{ token_hash: 'a', type: 'email', next: '/inicio' }, 'Confirmar e-mail'],
      [{ token_hash: 'a', type: 'invite', next: '/aceitar-convite' }, 'Aceitar convite'],
      [{ token_hash: 'a', type: 'recovery', next: '/aceitar-convite' }, 'Aceitar convite'],
      [{ token_hash: 'a', type: 'magiclink', next: '/inicio' }, 'Continuar'],
    ];
    for (const [query, label] of cases) {
      cleanup();
      await renderPage(query);
      expect(screen.getByRole('button').textContent).toBe(label);
    }
  });

  it('a missing token or unknown type redirects to the same fallbacks as the route', async () => {
    expect(await redirectOf({ type: 'recovery', next: '/redefinir-senha' })).toBe(
      '/esqueci-senha?erro=link-invalido',
    );
    expect(await redirectOf({ token_hash: 'a', type: 'nonsense' })).toBe(
      '/esqueci-senha?erro=link-invalido',
    );
    expect(await redirectOf({ type: 'signup' })).toBe('/verifique-seu-email?erro=link-invalido');
    expect(await redirectOf({ type: 'invite' })).toBe('/convite-expirado');
    expect(await redirectOf({ type: 'recovery', next: '/aceitar-convite' })).toBe(
      '/convite-expirado',
    );
  });

  it('a hostile next is rendered as /inicio', async () => {
    const { container } = await renderPage({
      token_hash: 'a',
      type: 'recovery',
      next: 'https://evil.example',
    });
    expect(hidden(container, 'next')).toBe('/inicio');
  });

  it('the token is an escaped attribute value, never markup', async () => {
    const token = 'a"><script>x</script>';
    const { container } = await renderPage({ token_hash: token, type: 'recovery', next: '/x' });
    expect(hidden(container, 'token_hash')).toBe(token);
    expect(container.querySelector('script')).toBeNull();
  });

  it('array search params take the first string; nothing server-side is touched', async () => {
    const { container } = await renderPage({
      token_hash: ['first', 'second'],
      type: ['recovery', 'signup'],
      next: ['/redefinir-senha', '/inicio'],
    });
    expect(hidden(container, 'token_hash')).toBe('first');
    expect(hidden(container, 'type')).toBe('recovery');
    expect(hidden(container, 'next')).toBe('/redefinir-senha');
    expect(mocks.touched).toEqual([]);
  });

  it('exports referrer same-origin (NOT no-referrer) and noindex', async () => {
    const { metadata } = await import('./page');
    expect(metadata.referrer).toBe('same-origin');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe('ConfirmForm: double-submit guard', () => {
  it('lets the first submit through, flips to the pending label, and blocks the second', () => {
    const { container } = render(
      <ConfirmForm
        tokenHash="abc"
        type="recovery"
        next="/redefinir-senha"
        label="Escolher nova senha"
        pendingLabel="Continuando..."
      />,
    );
    const form = container.querySelector('form') as HTMLFormElement;
    // fireEvent returns false when preventDefault was called.
    expect(fireEvent.submit(form)).toBe(true);
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('Continuando...');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(fireEvent.submit(form)).toBe(false);
  });
});

describe('round trip: GET -> page -> POST', () => {
  it('the recovery link survives the three hops and consumes the token exactly once', async () => {
    const origin = 'http://rede-demo.localhost:3000';
    let hop = '';
    try {
      await GET(
        new NextRequest(
          `${origin}/auth/confirm?token_hash=abc&type=recovery&next=/redefinir-senha`,
        ),
      );
    } catch (error) {
      hop = String((error as Error).message).slice('REDIRECT:'.length);
    }
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    const params = Object.fromEntries(new URL(hop, origin).searchParams);
    const { container } = await renderPage(params);
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    const body = new URLSearchParams({
      token_hash: hidden(container, 'token_hash') ?? '',
      type: hidden(container, 'type') ?? '',
      next: hidden(container, 'next') ?? '',
    });
    mocks.verifyOtp.mockResolvedValue({ error: null });
    const res = await POST(
      new NextRequest(`${origin}/auth/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
        body: body.toString(),
      }),
    );
    expect(mocks.verifyOtp).toHaveBeenCalledTimes(1);
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'abc' });
    expect(mocks.setCookie).toHaveBeenCalledWith('link_return', 'recovery', expect.anything());
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/redefinir-senha');
  });
});
