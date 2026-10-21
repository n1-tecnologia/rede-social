// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.1-15 (UI-D-522, UI-D-532, D-305, D-302; E09) — `/participar` for the join state `access_required`
 * keeps the h1 and the e-mail line, REPLACES the form by the no-access notice and adds the outline
 * "Verificar de novo" link and the shipped decline button. The "Assinar" link is the join state's, never
 * the URL's. Every other state is untouched. Real pt-BR catalog; the form controls are stubs.
 */

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), fetch: vi.fn() }));

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
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/env', () => ({ env: { API_URL: 'http://api.test' } }));
vi.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => mocks.apiFetch(...args) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: { email: 'ana@example.com' } } }) },
  }),
}));
vi.mock('@/lib/tenant-host', () => ({
  getHostTenant: async () => ({
    mode: 'tenant',
    host: 'demo.test',
    slug: 'rede-demo',
    displayName: 'Rede Demo',
  }),
}));
vi.mock('@/components/profile/RearmProfileNudge', () => ({ RearmProfileNudge: () => null }));
vi.mock('../AuthInput', () => ({
  AuthInput: ({ id, name }: { id: string; name: string }) => <input id={id} name={name} />,
}));
vi.mock('../ConsentFields', () => ({ ConsentFields: () => null }));
vi.mock('../SubmitButton', () => ({
  SubmitButton: ({ label }: { label: string }) => <button type="submit">{label}</button>,
}));
vi.mock('./actions', () => ({ join: vi.fn(), declineJoin: vi.fn() }));

const { default: ParticiparPage } = await import('./page');

const SENTENCE = 'Seu acesso ainda não foi liberado. Use o mesmo e-mail da compra.';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function state(body: unknown) {
  mocks.apiFetch.mockImplementation(async () => json(200, body));
}

async function show(searchParams: Record<string, string> = {}) {
  render(await ParticiparPage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(async () =>
    Response.json({
      slug: 'rede-demo',
      displayName: 'Rede Demo',
      rulesText: 'Regras',
      rulesVersion: 1,
      termsVersion: 1,
    }),
  );
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/participar: access_required', () => {
  it('renders the h1, the e-mail line, the notice, “Verificar de novo” and the decline button, and NO form', async () => {
    state({ state: 'access_required', accessCheckoutUrl: 'https://pay.example/c/1' });
    await show();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Participar de Rede Demo');
    expect(document.body.textContent).toContain('Você entrou como ana@example.com.');
    const notice = screen.getByRole('alert');
    expect(notice.textContent).toContain(SENTENCE);
    expect(notice.className).not.toMatch(/text-danger/);
    expect(screen.getByRole('link', { name: /Assinar/ }).getAttribute('href')).toBe(
      'https://pay.example/c/1',
    );
    const retry = screen.getByRole('link', { name: 'Verificar de novo' });
    expect(retry.getAttribute('href')).toBe('/participar');
    expect(retry.className).toContain('border-border-secondary');
    expect(screen.getByRole('button', { name: 'Não participar' })).toBeTruthy();
    expect(document.querySelector('input[name="name"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Participar' })).toBeNull();
    // The join form is never reached, so the public record is not read either.
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('puts the notice before the retry link and the decline button', async () => {
    state({ state: 'access_required' });
    await show();
    const notice = screen.getByRole('alert');
    const retry = screen.getByRole('link', { name: 'Verificar de novo' });
    const decline = screen.getByRole('button', { name: 'Não participar' });
    expect(notice.compareDocumentPosition(retry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(retry.compareDocumentPosition(decline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('without a stored link (absent or null) renders the sentence and no Assinar button', async () => {
    for (const body of [
      { state: 'access_required' },
      { state: 'access_required', accessCheckoutUrl: null },
    ]) {
      state(body);
      await show();
      expect(screen.getByRole('alert').textContent).toContain(SENTENCE);
      expect(screen.queryByRole('link', { name: /Assinar/ })).toBeNull();
      cleanup();
    }
  });

  it('ignores a link-shaped query string and refuses an unsafe state link', async () => {
    state({ state: 'access_required', accessCheckoutUrl: 'javascript:alert(1)' });
    await show({
      link: 'https://evil.example/',
      checkout: 'https://evil.example/',
      erro: 'nao-liberado',
    });
    expect(screen.queryByRole('link', { name: /Assinar/ })).toBeNull();
    expect(document.body.innerHTML).not.toContain('evil.example');
    cleanup();
    state({ state: 'access_required', accessCheckoutUrl: 'https://pay.example/ok' });
    await show({ link: 'https://evil.example/' });
    expect(screen.getByRole('link', { name: /Assinar/ }).getAttribute('href')).toBe(
      'https://pay.example/ok',
    );
    expect(document.body.innerHTML).not.toContain('evil.example');
  });

  it('names only the host’s community and none of the gateway vocabulary', async () => {
    state({ state: 'access_required', accessCheckoutUrl: 'https://pay.example/c/1' });
    await show();
    expect(document.body.textContent).not.toMatch(/gateway|webhook|token|membership/i);
    expect(document.body.textContent).not.toContain('Rede Lab');
  });
});

describe('/participar: the other states are untouched', () => {
  it('joinable still renders the form with an empty name field and no notice', async () => {
    state({ state: 'joinable' });
    await show();
    expect(document.querySelector('input[name="name"]')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Verificar de novo' })).toBeNull();
  });

  it('removed still renders the refused card', async () => {
    state({ state: 'removed' });
    await show();
    expect(document.body.textContent).toContain('Não foi possível participar');
    expect(document.body.textContent).not.toContain('Use o mesmo e-mail da compra');
  });

  it('member still redirects to /inicio', async () => {
    state({ state: 'member' });
    await expect(show()).rejects.toThrow('REDIRECT:/inicio');
  });
});

describe('/participar: secrecy and a byte-identical sentence (D-302, T-09.1-71)', () => {
  it('the card says exactly the sentence for access_required, with no other community named', async () => {
    state({ state: 'access_required', accessCheckoutUrl: null });
    await show({ comunidade: 'Rede Lab' });
    expect(screen.getByRole('alert').textContent).toBe(SENTENCE);
    expect(document.body.textContent).not.toContain('Rede Lab');
  });

  it('a state body carrying anything else (a second community) is refused as a whole, never rendered', async () => {
    state({ state: 'access_required', outraComunidade: 'Rede Lab' });
    await expect(show()).rejects.toThrow();
    expect(document.body.textContent).not.toContain('Rede Lab');
  });
});
