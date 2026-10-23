// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.1-15 (UI-D-522, UI-D-532, D-302, D-493; E09) — `/cadastro?erro=nao-liberado` replaces the red alert
 * line by the no-access notice ABOVE the form, in the plain form and in the "já tem conta" state. The form
 * stays (the e-mail field keeps no value) and the "Assinar" link is the public tenant record's, never the
 * URL's. Real pt-BR catalog; the form controls are stubs.
 */

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  draft: null as { email: string } | null,
  status: 'active' as string | undefined,
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
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/host-brand', () => ({
  getHostBrand: async () => ({
    tenant: mocks.status === undefined ? null : { status: mocks.status },
  }),
}));
vi.mock('@/lib/join-draft', () => ({ readJoinDraft: async () => mocks.draft }));
vi.mock('@/lib/tenant-host', () => ({
  getHostTenant: async () => ({
    mode: 'tenant',
    host: 'demo.test',
    slug: 'rede-demo',
    displayName: 'Rede Demo',
  }),
  signupPath: () => '/cadastro',
}));
vi.mock('@/components/profile/RearmProfileNudge', () => ({ RearmProfileNudge: () => null }));
vi.mock('../../AuthInput', () => ({
  AuthInput: ({ id, name }: { id: string; name: string }) => <input id={id} name={name} />,
}));
vi.mock('../../ConsentFields', () => ({ ConsentFields: () => null }));
vi.mock('../../PasswordField', () => ({
  PasswordField: ({ id, name }: { id: string; name: string }) => (
    <input id={id} name={name} type="password" />
  ),
}));
vi.mock('../../SubmitButton', () => ({
  SubmitButton: ({ label }: { label: string }) => <button type="submit">{label}</button>,
}));
vi.mock('./actions', () => ({ signup: vi.fn(), joinFromSignup: vi.fn() }));

const { default: CadastroPage } = await import('./page');

const SENTENCE = 'Seu acesso ainda não foi liberado. Use o mesmo e-mail da compra.';

const publicTenant = (accessCheckoutUrl?: string | null) => ({
  slug: 'rede-demo',
  displayName: 'Rede Demo',
  rulesText: 'Regras',
  rulesVersion: 1,
  termsVersion: 1,
  ...(accessCheckoutUrl === undefined ? {} : { accessCheckoutUrl }),
});

async function show(searchParams: Record<string, string>) {
  render(
    await CadastroPage({
      params: Promise.resolve({ slug: 'rede-demo' }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

beforeEach(() => {
  mocks.draft = null;
  mocks.status = 'active';
  mocks.fetch.mockReset();
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/cadastro: the no-access notice', () => {
  it('shows the notice above the form with the public record’s link, and the form stays', async () => {
    mocks.fetch.mockImplementation(async () =>
      Response.json(publicTenant('https://pay.example/c/1')),
    );
    await show({ erro: 'nao-liberado' });
    const notice = screen.getByRole('alert');
    expect(notice.textContent).toContain(SENTENCE);
    expect(notice.className).not.toMatch(/text-danger/);
    expect(screen.getByRole('link', { name: /Assinar/ }).getAttribute('href')).toBe(
      'https://pay.example/c/1',
    );
    const form = document.querySelector('form') as HTMLFormElement;
    expect(notice.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const field of ['name', 'email', 'password']) {
      const input = form.querySelector(`#${field}`) as HTMLInputElement | null;
      expect(input, field).not.toBeNull();
      expect(input?.getAttribute('value')).toBeNull();
    }
  });

  it('without a registered link renders the sentence and no button', async () => {
    for (const record of [publicTenant(), publicTenant(null)]) {
      mocks.fetch.mockImplementation(async () => Response.json(record));
      await show({ erro: 'nao-liberado' });
      expect(screen.getByRole('alert').textContent).toContain(SENTENCE);
      expect(screen.queryByRole('link', { name: /Assinar/ })).toBeNull();
      cleanup();
    }
  });

  it('renders no notice without the error parameter', async () => {
    mocks.fetch.mockImplementation(async () =>
      Response.json(publicTenant('https://pay.example/c/1')),
    );
    await show({});
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('link', { name: /Assinar/ })).toBeNull();
  });

  it('the “já tem conta” state uses the same notice above its form', async () => {
    mocks.draft = { email: 'ana@example.com' };
    mocks.fetch.mockImplementation(async () =>
      Response.json(publicTenant('https://pay.example/c/1')),
    );
    await show({ estado: 'ja-tem-conta', erro: 'nao-liberado' });
    const notice = screen.getByRole('alert');
    expect(notice.textContent).toContain(SENTENCE);
    expect(notice.className).not.toMatch(/text-danger/);
    expect(screen.getByRole('link', { name: /Assinar/ })).toBeTruthy();
    const form = document.querySelector('form') as HTMLFormElement;
    expect(notice.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('other errors keep their red alert line, and the old short sentence is gone', async () => {
    mocks.fetch.mockImplementation(async () => Response.json(publicTenant()));
    await show({ erro: 'validacao' });
    expect(screen.getByRole('alert').className).toContain('text-danger');
    expect(document.body.textContent).not.toContain('Use o mesmo e-mail da compra');
  });

  it('ignores a link-shaped query string and refuses an unsafe stored value', async () => {
    mocks.fetch.mockImplementation(async () =>
      Response.json(publicTenant('http://pay.example/insecure')),
    );
    await show({
      erro: 'nao-liberado',
      link: 'https://evil.example/',
      checkout: 'https://evil.example/',
    });
    expect(screen.queryByRole('link', { name: /Assinar/ })).toBeNull();
    expect(document.body.innerHTML).not.toContain('evil.example');
  });

  it('names only the host’s community', async () => {
    mocks.fetch.mockImplementation(async () =>
      Response.json(publicTenant('https://pay.example/c/1')),
    );
    await show({ erro: 'nao-liberado', comunidade: 'Outra Comunidade' });
    expect(document.body.textContent).not.toContain('Outra Comunidade');
    expect(screen.getByRole('alert').textContent).not.toMatch(/gateway|webhook|token|membership/i);
  });
});

describe('/cadastro: secrecy and a byte-identical sentence (D-302, T-09.1-71)', () => {
  it('without a link the card says exactly the sentence, in the plain form and the “já tem conta” state', async () => {
    mocks.fetch.mockImplementation(async () =>
      Response.json({ ...publicTenant(null), outraComunidade: 'Rede Lab' }),
    );
    await show({ erro: 'nao-liberado' });
    expect(screen.getByRole('alert').textContent).toBe(SENTENCE);
    expect(document.body.textContent).not.toContain('Rede Lab');
    cleanup();
    mocks.draft = { email: 'ana@example.com' };
    await show({ estado: 'ja-tem-conta', erro: 'nao-liberado' });
    expect(screen.getByRole('alert').textContent).toBe(SENTENCE);
    expect(document.body.textContent).not.toContain('Rede Lab');
  });
});

/**
 * 09.2-21 (UI-D-542, A-UI-8; E10; P104, P105) — the sign-up form steps aside for every held-out state with
 * the state's glyph and sentences, before the public record is even read; on a generic host (no host status)
 * the slug record's own 503 produces the same card.
 */
describe('/cadastro: the held-out host cards (09.2-21)', () => {
  it.each([
    ['suspended', 'Comunidade indisponível', 'lucide-triangle-alert'],
    ['unavailable', 'Comunidade indisponível', 'lucide-triangle-alert'],
    ['updating', 'Comunidade em atualização', 'lucide-refresh-cw'],
    ['preparing', 'Comunidade em preparação', 'lucide-hourglass'],
  ])(
    '%s renders the card with its glyph instead of the form and reads nothing',
    async (status, title, glyph) => {
      mocks.status = status;
      await show({});
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeTruthy();
      const svg = document.querySelector('h2')?.parentElement?.querySelector('svg');
      expect(svg?.classList.contains(glyph)).toBe(true);
      expect(svg?.getAttribute('width')).toBe('28');
      expect(document.querySelector('form')).toBeNull();
      expect(document.querySelector('input')).toBeNull();
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toMatch(
        /banco|projeto|esquema|migra[cç][aã]o|supabase|tenant/i,
      );
    },
  );

  it('paused and unreachable read byte-identically to a suspension (A-UI-8)', async () => {
    mocks.status = 'suspended';
    await show({});
    const suspended = document.body.innerHTML;
    cleanup();
    mocks.status = 'unavailable';
    await show({});
    expect(document.body.innerHTML).toBe(suspended);
  });

  it('P105: a cleared state brings the form back on the next render', async () => {
    mocks.status = 'preparing';
    await show({});
    expect(document.querySelector('form')).toBeNull();
    cleanup();
    mocks.status = 'active';
    mocks.fetch.mockImplementation(async () => Response.json(publicTenant()));
    await show({});
    expect(document.querySelector('form')).not.toBeNull();
  });

  it.each([
    ['TENANT_UPDATING', 'Comunidade em atualização'],
    ['TENANT_PREPARING', 'Comunidade em preparação'],
    ['TENANT_UNAVAILABLE', 'Comunidade indisponível'],
  ])(
    'a generic host: the slug record answering 503 %s renders the same card',
    async (code, title) => {
      mocks.status = undefined;
      mocks.fetch.mockImplementation(async () =>
        Response.json({ error: { code, message: 'x', requestId: 'req-1' } }, { status: 503 }),
      );
      await show({});
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeTruthy();
      expect(document.querySelector('form')).toBeNull();
    },
  );

  it('a generic host: a 503 without a held-out code is still "não encontrada"', async () => {
    mocks.status = undefined;
    mocks.fetch.mockImplementation(async () => new Response('x', { status: 503 }));
    await expect(show({})).rejects.toThrow('NOT_FOUND');
  });
});
