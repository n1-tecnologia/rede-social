// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.1-15 (UI-D-521, UI-D-532, D-497, D-499; E08) — the full-screen "Sua assinatura não está ativa" page,
 * against the REAL merged pt-BR catalog. Stubbed: `apiFetch` (so the real `getSubscriptionStatus` and
 * `safeCheckoutUrl` run), the sign-out form and its server action. The web workspace has no jest-dom.
 */

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => mocks.apiFetch(...args) }));
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
vi.mock('@/app/(app)/actions', () => ({ logout: vi.fn() }));
vi.mock('@/components/shell/LogoutForm', () => ({
  LogoutForm: ({ children, action }: { children: ReactNode; action: unknown }) => (
    <form data-logout-form data-has-action={typeof action === 'function'}>
      {children}
    </form>
  ),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { default: SubscriptionPendingPage } = await import('./page');

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function show(searchParams: Record<string, string> = {}) {
  render(await SubscriptionPendingPage({ searchParams: Promise.resolve(searchParams) }));
}

const TITLE = 'Sua assinatura não está ativa';
const BODY =
  'Assim que o pagamento for confirmado, seu acesso volta sozinho. Seu perfil e suas publicações continuam guardados.';

beforeEach(() => {
  mocks.apiFetch.mockReset();
});
afterEach(() => cleanup());

describe('SubscriptionPendingPage: with a stored checkout link', () => {
  beforeEach(() => {
    mocks.apiFetch.mockImplementation(async () =>
      json(200, { tenantName: 'Clínica Ana', checkoutUrl: 'https://pay.example/c/123' }),
    );
  });

  it('renders the title, the body without the doubt line and the three actions in order', async () => {
    await show({ t: 'Clínica Ana' });
    expect(screen.getByText(TITLE)).toBeTruthy();
    expect(screen.getByText(BODY)).toBeTruthy();
    expect(document.body.textContent).not.toContain('fale com a equipe');
    const actions = [...document.querySelectorAll('a, button')].map((el) => el.textContent ?? '');
    expect(actions[0]).toContain('Regularizar');
    expect(actions[1]).toBe('Verificar de novo');
    expect(actions[2]).toBe('Sair');
  });

  it('draws Regularizar as an external link with the hidden new-tab suffix', async () => {
    await show();
    const pay = screen.getByRole('link', { name: /Regularizar/ });
    expect(pay.getAttribute('href')).toBe('https://pay.example/c/123');
    expect(pay.getAttribute('target')).toBe('_blank');
    expect(pay.getAttribute('rel')).toBe('noopener noreferrer');
    expect(pay.querySelector('.sr-only')?.textContent).toContain('nova aba');
    expect(pay.querySelector('svg')).toBeTruthy();
  });

  it('points Verificar de novo at /inicio and keeps Sair inside the logout form', async () => {
    await show();
    expect(screen.getByRole('link', { name: 'Verificar de novo' }).getAttribute('href')).toBe(
      '/inicio',
    );
    const form = document.querySelector('form[data-logout-form]');
    expect(form?.getAttribute('data-has-action')).toBe('true');
    expect(form?.querySelector('button')?.textContent).toBe('Sair');
  });

  it('stacks full-width lg actions with gap-2', async () => {
    await show();
    const stack = screen.getByRole('link', { name: 'Verificar de novo' })
      .parentElement as HTMLElement;
    expect(stack.className).toContain('gap-2');
    expect(stack.className).toContain('flex-col');
    expect(screen.getByRole('link', { name: 'Verificar de novo' }).className).toContain('w-full');
  });
});

describe('SubscriptionPendingPage: without a link, and when the read fails (E08 error)', () => {
  it('without a stored link renders the body WITH the doubt line and no Regularizar', async () => {
    mocks.apiFetch.mockImplementation(async () =>
      json(200, { tenantName: 'Clínica Ana', checkoutUrl: null }),
    );
    await show();
    expect(screen.getByText(/Em caso de dúvida, fale com a equipe de Clínica Ana\./)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Regularizar/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Verificar de novo' })).toBeTruthy();
  });

  it('a failed read behaves as without a link, using the ?t= name as the only text', async () => {
    mocks.apiFetch.mockImplementation(async () => json(500, {}));
    await show({ t: 'Rede Demo' });
    expect(screen.getByText(/fale com a equipe de Rede Demo\./)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Regularizar/ })).toBeNull();
    expect(screen.getByText(TITLE)).toBeTruthy();
  });

  it('a transport failure and a missing ?t= fall back to the catalog word, without throwing', async () => {
    mocks.apiFetch.mockImplementation(async () => {
      throw new Error('network');
    });
    await show();
    expect(screen.getByText(/fale com a equipe de sua comunidade\./)).toBeTruthy();
  });
});

describe('SubscriptionPendingPage: layout rows (E08 overflow, long text)', () => {
  it('wraps a very long tenant name as a text node with break-words and keeps full-width buttons', async () => {
    const name = `Clínica ${'MuitoLongo'.repeat(20)}`;
    mocks.apiFetch.mockImplementation(async () =>
      json(200, { tenantName: name, checkoutUrl: null }),
    );
    await show();
    const line = screen.getByText(new RegExp(`fale com a equipe de ${name}`));
    expect(line.closest('.break-words')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Verificar de novo' }).className).toContain('w-full');
    expect(screen.getByRole('button', { name: 'Sair' }).className).toContain('w-full');
  });
});

describe('SubscriptionPendingPage: provenance of the link and the name (UI-D-532, T-09.1-70, T-09.1-74)', () => {
  it('ignores a link-shaped query string: the anchor, when any, is the API’s value', async () => {
    mocks.apiFetch.mockImplementation(async () =>
      json(200, { tenantName: 'Rede Demo', checkoutUrl: 'https://pay.example/real' }),
    );
    await show({
      link: 'https://evil.example/',
      checkout: 'https://evil.example/',
      erro: 'https://evil.example/',
    });
    const hrefs = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://pay.example/real');
    expect(hrefs.join(' ')).not.toContain('evil');
  });

  it('does not invent a link from the query string when the API holds none', async () => {
    mocks.apiFetch.mockImplementation(async () =>
      json(200, { tenantName: 'Rede Demo', checkoutUrl: null }),
    );
    await show({ t: 'https://evil.example/', link: 'https://evil.example/' });
    expect(screen.queryByRole('link', { name: /Regularizar/ })).toBeNull();
    expect([...document.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/inicio',
    ]);
  });

  it('renders no anchor for a javascript:, data:, http:, protocol-relative, credentialed or over-long value', async () => {
    for (const checkoutUrl of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'http://pay.example/x',
      '//evil.example/x',
      'https://user:pw@evil.example/x',
      `https://evil.example/${'a'.repeat(3000)}`,
    ]) {
      mocks.apiFetch.mockImplementation(async () =>
        json(200, { tenantName: 'Rede Demo', checkoutUrl }),
      );
      await show();
      expect(screen.queryByRole('link', { name: /Regularizar/ }), checkoutUrl).toBeNull();
      expect(document.body.innerHTML).not.toContain('evil.example');
      cleanup();
    }
  });

  it('renders the ?t= name as escaped text, never as markup', async () => {
    mocks.apiFetch.mockImplementation(async () => json(500, {}));
    await show({ t: '<b>Negrito</b><script>alert(1)</script>' });
    expect(document.querySelector('b')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect(document.body.textContent).toContain('<b>Negrito</b>');
  });

  it('names no other community and uses none of the gateway vocabulary', async () => {
    mocks.apiFetch.mockImplementation(async () =>
      json(200, { tenantName: 'Rede Demo', checkoutUrl: null }),
    );
    await show();
    expect(document.body.textContent).not.toMatch(/gateway|webhook|token|membership/i);
    expect(document.body.textContent).not.toMatch(/suspens|bloquead|moderação/i);
  });
});

describe('SubscriptionPendingPage: the session is kept (D-499, T-09.1-72)', () => {
  it('imports nothing that signs out or clears cookies, apart from the shipped logout form', () => {
    const source = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
    expect(source).not.toMatch(/\.sign[O]ut\(|Forget[S]ignedOutDevice|lib\/supabase|cookies\(/);
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports).not.toContain('next/headers');
    expect(imports.some((i) => /supabase/.test(i ?? ''))).toBe(false);
  });

  it('renders without a session-clearing component and reads the endpoint per request', async () => {
    mocks.apiFetch.mockImplementation(async () =>
      json(200, { tenantName: 'Rede Demo', checkoutUrl: null }),
    );
    await show();
    expect(document.querySelectorAll('form').length).toBe(1);
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    expect(mocks.apiFetch).toHaveBeenCalledWith('/v1/me/subscription');
  });

  it('is idempotent: rendering twice gives the same screen and reads twice', async () => {
    mocks.apiFetch.mockImplementation(async () =>
      json(200, { tenantName: 'Rede Demo', checkoutUrl: null }),
    );
    await show();
    const first = document.body.innerHTML;
    cleanup();
    await show();
    expect(document.body.innerHTML).toBe(first);
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
  });
});
