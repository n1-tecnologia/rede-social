// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { form, question } from '@/lib/profile-form/test-fixtures';

/**
 * 12-12 (D-580..D-584, UI-D-581, UI-D-588; PFORM-13, PFORM-14, RESEARCH Pitfall 2) — the completion route,
 * against the REAL merged pt-BR catalog. Stubbed: the API boundary (`apiFetch`, so the real loader and
 * contract run), the bootstrap read (the real `loadOrRedirect` and `bootstrapRedirectPath` run), the
 * sign-out form and the router. The web workspace has no jest-dom.
 */

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  getBootstrap: vi.fn(),
  push: vi.fn(),
}));

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

vi.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => mocks.apiFetch(...args) }));
vi.mock('@/lib/bootstrap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bootstrap')>()),
  getBootstrap: mocks.getBootstrap,
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
  useRouter: () => ({ push: mocks.push, refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});
vi.mock('@/app/(app)/actions', () => ({ logout: vi.fn() }));
vi.mock('./actions', () => ({ saveProfileFormAction: vi.fn() }));
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

const { default: CompletePage } = await import('./page');

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const bootstrapFor = (role: string) => ({
  membership: { role },
  tenant: { displayName: 'Ana Mentoria' },
});

async function show(searchParams: Record<string, string> = {}) {
  const ui = await CompletePage({ searchParams: Promise.resolve(searchParams) });
  render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const readsOfForm = () =>
  mocks.apiFetch.mock.calls.filter(([path]) => path === '/v1/me/profile-form').length;

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.getBootstrap.mockReset();
  mocks.push.mockReset();
  mocks.getBootstrap.mockResolvedValue(bootstrapFor('member'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => cleanup());

describe('CompletePage: the three modes come from the API read', () => {
  it('first: heading, tenant intro, the questions, one Salvar and Sair', async () => {
    const q = question('short_text', { title: 'Qual é o seu cargo?', required: true });
    mocks.apiFetch.mockImplementation(async () => json(200, form([q])));
    await show();
    expect(screen.getByRole('heading', { name: 'Complete seu perfil' })).toBeTruthy();
    expect(document.body.textContent).toContain('Ana Mentoria pede estas informações');
    expect(screen.getByLabelText('Qual é o seu cargo?')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Salvar' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Sair' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Cancelar' })).toBeNull();
  });

  it('returning: the heading, the missing notice and the flagged question', async () => {
    const answered = question('short_text', { title: 'Cargo', required: true, answer: 'Designer' });
    const missing = question('short_text', { title: 'Telefone da empresa', required: true });
    mocks.apiFetch.mockImplementation(async () =>
      json(200, form([answered, missing], { mode: 'returning', missingRequired: 1 })),
    );
    await show();
    expect(screen.getByRole('heading', { name: 'Faltam algumas respostas' })).toBeTruthy();
    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain('Falta 1 pergunta obrigatória.');
    expect((screen.getByLabelText('Cargo') as HTMLInputElement).value).toBe('Designer');
    expect(document.body.textContent).toContain('Falta responder');
    expect(screen.getByRole('button', { name: 'Sair' })).toBeTruthy();
  });

  it('edit: Minhas respostas, Cancelar to /perfil by default, to a valid next, and no Sair', async () => {
    const q = question('short_text', { answer: 'x' });
    mocks.apiFetch.mockImplementation(async () =>
      json(200, form([q], { mode: 'edit', missingRequired: 0 })),
    );
    await show();
    expect(screen.getByRole('heading', { name: 'Minhas respostas' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cancelar' }).getAttribute('href')).toBe('/perfil');
    expect(screen.queryByRole('button', { name: 'Sair' })).toBeNull();
    cleanup();
    await show({ next: '/membros/9' });
    expect(screen.getByRole('link', { name: 'Cancelar' }).getAttribute('href')).toBe('/membros/9');
    cleanup();
    await show({ next: '//evil.com' });
    expect(screen.getByRole('link', { name: 'Cancelar' }).getAttribute('href')).toBe('/perfil');
  });

  it('a brand-new member and an old one with the same stored answers see the same screen (PFORM-13)', async () => {
    const q = question('short_text', { title: 'Cargo', required: true, answer: 'Designer' });
    const read = form([q], { mode: 'edit', missingRequired: 0 });
    mocks.apiFetch.mockImplementation(async () => json(200, read));
    await show({ next: '/inicio' });
    const first = document.body.innerHTML;
    cleanup();
    mocks.apiFetch.mockImplementation(async () => json(200, read));
    await show({ t: 'Outro nome', next: '/inicio' });
    expect(document.body.innerHTML).toBe(first);
  });

  it('keeps the admin order whatever the stored answers are (PFORM-13)', async () => {
    const a = question('short_text', { title: 'Primeira', answer: 'zzz' });
    const b = question('short_text', { title: 'Segunda' });
    const c = question('short_text', { title: 'Terceira', answer: 'aaa' });
    mocks.apiFetch.mockImplementation(async () =>
      json(200, form([a, b, c], { mode: 'edit', missingRequired: 0 })),
    );
    await show();
    const labels = [...document.querySelectorAll('label')].map((el) => el.textContent);
    expect(labels).toEqual(['Primeira', 'Segunda', 'Terceira']);
  });
});

describe('CompletePage: who is asked (D-584)', () => {
  it.each(['admin_tenant', 'support_tenant', 'super_admin'])(
    '%s is sent to /inicio with no read of the form',
    async (role) => {
      mocks.getBootstrap.mockResolvedValue(bootstrapFor(role));
      await expect(show()).rejects.toThrow('REDIRECT /inicio');
      expect(readsOfForm()).toBe(0);
      expect(mocks.apiFetch).not.toHaveBeenCalled();
    },
  );

  it('a bootstrap refusal follows the shipped navigation (never a loop to itself)', async () => {
    const { ApiClientError } = await import('@/lib/bootstrap');
    mocks.getBootstrap.mockRejectedValue(new ApiClientError(401, 'UNAUTHENTICATED'));
    await expect(show()).rejects.toThrow('REDIRECT /entrar');
  });
});

describe('CompletePage: nothing to answer and a failed read (UI-D-588)', () => {
  it('mode none shows the empty state and a way home', async () => {
    mocks.apiFetch.mockImplementation(async () =>
      json(200, form([], { mode: 'none', missingRequired: 0 })),
    );
    await show();
    expect(screen.getByText('Não há perguntas para responder')).toBeTruthy();
    expect(screen.getByText('Você já está com tudo em dia.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir para o início' }).getAttribute('href')).toBe(
      '/inicio',
    );
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
  });

  it('a failed read shows the error state, a retry that keeps a valid next, and Sair', async () => {
    mocks.apiFetch.mockImplementation(async () => json(500, { error: { code: 'INTERNAL' } }));
    await show({ next: '/post/abc' });
    expect(screen.getByText('Algo deu errado')).toBeTruthy();
    expect(screen.getByText('Não foi possível carregar as perguntas agora.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tentar de novo' }).getAttribute('href')).toBe(
      '/completar-perfil?next=%2Fpost%2Fabc',
    );
    expect(screen.getByRole('button', { name: 'Sair' })).toBeTruthy();
  });

  it('a body that breaks the contract is also the error state, never a blank page', async () => {
    mocks.apiFetch.mockImplementation(async () => json(200, { mode: 'first' }));
    await show();
    expect(screen.getByText('Algo deu errado')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sair' })).toBeTruthy();
  });

  it('a session refusal on the form read follows the shipped navigation', async () => {
    mocks.apiFetch.mockImplementation(async () =>
      json(401, { error: { code: 'UNAUTHENTICATED' } }),
    );
    await expect(show()).rejects.toThrow('REDIRECT /entrar');
  });
});

describe('CompletePage: the module never names the redirecting guard (RESEARCH Pitfall 2)', () => {
  it('page.tsx reads getBootstrap through loadOrRedirect and does not import the (app) guard', () => {
    const source = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
    expect(source).not.toMatch(/requireBootstrap/);
    expect(source).toMatch(/loadOrRedirect\(getBootstrap, bootstrapRedirectPath\)/);
    expect(source).not.toMatch(/next\/headers/);
    expect(source).not.toMatch(/supabase/i);
  });
});
