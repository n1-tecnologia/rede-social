// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.1-15 (UI-D-522, UI-D-532, D-302, D-493; E09) — `/entrar?erro=nao-liberado` shows the no-access
 * notice ABOVE the form instead of the red alert line. The checkout link comes from the public tenant
 * record by the HOST's slug, fetched only on that error path; a generic or platform host has no
 * community, so the sentence stands alone. Real pt-BR catalog; the form controls are stubs.
 */

const mocks = vi.hoisted(() => ({
  brand: {} as Record<string, unknown>,
  fetch: vi.fn(),
  cookie: undefined as string | undefined,
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
  cookies: async () => ({
    get: (name: string) =>
      name === 'tenant_slug' && mocks.cookie ? { value: mocks.cookie } : undefined,
  }),
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
vi.mock('@/lib/host-brand', () => ({ getHostBrand: async () => mocks.brand }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: null }) } }),
}));
vi.mock('@/lib/tenant-host', () => ({ signupPath: () => '/cadastro' }));
vi.mock('@/components/profile/RearmProfileNudge', () => ({ RearmProfileNudge: () => null }));
vi.mock('@/components/push/ForgetSignedOutDevice', () => ({ ForgetSignedOutDevice: () => null }));
vi.mock('../AuthBrand', () => ({ hasLogo: () => false }));
vi.mock('../AuthInput', () => ({
  AuthInput: ({ id, name }: { id: string; name: string }) => <input id={id} name={name} />,
}));
vi.mock('../SubmitButton', () => ({
  SubmitButton: ({ label }: { label: string }) => <button type="submit">{label}</button>,
}));
vi.mock('./actions', () => ({ login: vi.fn() }));

const { default: EntrarPage } = await import('./page');

const SENTENCE = 'Seu acesso ainda não foi liberado. Use o mesmo e-mail da compra.';

const tenantBrand = {
  mode: 'tenant',
  displayName: 'Rede Demo',
  tenant: { slug: 'rede-demo', status: 'active' },
  branding: {},
};

const publicTenant = (accessCheckoutUrl?: string | null) => ({
  slug: 'rede-demo',
  displayName: 'Rede Demo',
  rulesText: 'r',
  rulesVersion: 1,
  termsVersion: 1,
  ...(accessCheckoutUrl === undefined ? {} : { accessCheckoutUrl }),
});

async function show(searchParams: Record<string, string>) {
  render(await EntrarPage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  mocks.cookie = undefined;
  mocks.brand = tenantBrand;
  mocks.fetch.mockReset();
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/entrar: the no-access notice', () => {
  it('on a tenant host shows the notice above the form, with the link from the public tenant record', async () => {
    mocks.fetch.mockImplementation(async () =>
      Response.json(publicTenant('https://pay.example/c/1')),
    );
    await show({ erro: 'nao-liberado' });
    const notice = screen.getByRole('alert');
    expect(notice.textContent).toContain(SENTENCE);
    expect(notice.className).not.toMatch(/text-danger/);
    const anchor = screen.getByRole('link', { name: /Assinar/ });
    expect(anchor.getAttribute('href')).toBe('https://pay.example/c/1');
    expect(anchor.getAttribute('target')).toBe('_blank');
    const form = document.querySelector('form') as HTMLFormElement;
    expect(form).not.toBeNull();
    expect(notice.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0]?.[0]).toBe('http://api.test/v1/public/tenants/rede-demo');
    expect(mocks.fetch.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' });
  });

  it('without a registered link (key absent or null) renders the sentence and no button', async () => {
    for (const record of [publicTenant(), publicTenant(null)]) {
      mocks.fetch.mockImplementation(async () => Response.json(record));
      await show({ erro: 'nao-liberado' });
      expect(screen.getByRole('alert').textContent).toContain(SENTENCE);
      expect(screen.queryByRole('link', { name: /Assinar/ })).toBeNull();
      cleanup();
    }
  });

  it('reads the public record ONLY on the error path', async () => {
    await show({});
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();
    await show({ erro: 'credenciais' });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Email ou senha incorretos.');
  });

  it('on a generic host shows the sentence with no link, even when the cookie names a community', async () => {
    mocks.brand = { mode: 'generic', displayName: null, tenant: null, branding: {} };
    mocks.cookie = 'rede-lab';
    mocks.fetch.mockImplementation(async () =>
      Response.json(publicTenant('https://pay.example/other-community')),
    );
    await show({ erro: 'nao-liberado' });
    expect(screen.getByRole('alert').textContent).toContain(SENTENCE);
    expect(screen.queryByRole('link', { name: /Assinar/ })).toBeNull();
    expect(document.body.innerHTML).not.toContain('other-community');
    // The only request is the shipped "Comunidade: …" hint; the notice made none of its own.
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('on the platform host shows the sentence with no link and makes no request', async () => {
    mocks.brand = { mode: 'platform', displayName: null, tenant: null, branding: {} };
    mocks.cookie = 'rede-lab';
    await show({ erro: 'nao-liberado' });
    expect(screen.getByRole('alert').textContent).toContain(SENTENCE);
    expect(screen.queryByRole('link', { name: /Assinar/ })).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('a failed or malformed public record degrades to the sentence alone', async () => {
    mocks.fetch.mockImplementationOnce(async () => new Response('x', { status: 500 }));
    await show({ erro: 'nao-liberado' });
    expect(screen.queryByRole('link', { name: /Assinar/ })).toBeNull();
    cleanup();
    mocks.fetch.mockImplementationOnce(async () => {
      throw new Error('network');
    });
    await show({ erro: 'nao-liberado' });
    expect(screen.getByRole('alert').textContent).toContain(SENTENCE);
    expect(screen.queryByRole('link', { name: /Assinar/ })).toBeNull();
  });

  it('ignores a link-shaped query string and refuses an unsafe stored value', async () => {
    mocks.fetch.mockImplementation(async () => Response.json(publicTenant('javascript:alert(1)')));
    await show({
      erro: 'nao-liberado',
      link: 'https://evil.example/',
      checkout: 'https://evil.example/',
    });
    expect(screen.queryByRole('link', { name: /Assinar/ })).toBeNull();
    expect(document.body.innerHTML).not.toContain('evil.example');
    cleanup();
    mocks.fetch.mockImplementation(async () =>
      Response.json(publicTenant('https://pay.example/ok')),
    );
    await show({ erro: 'nao-liberado', link: 'https://evil.example/' });
    expect(screen.getByRole('link', { name: /Assinar/ }).getAttribute('href')).toBe(
      'https://pay.example/ok',
    );
    expect(document.body.innerHTML).not.toContain('evil.example');
  });

  it('names no community other than the host’s and none of the gateway vocabulary', async () => {
    mocks.fetch.mockImplementation(async () =>
      Response.json(publicTenant('https://pay.example/c/1')),
    );
    await show({ erro: 'nao-liberado', outra: 'Outra Comunidade' });
    expect(document.body.textContent).not.toContain('Outra Comunidade');
    expect(screen.getByRole('alert').textContent).not.toMatch(/gateway|webhook|token|membership/i);
  });
});

describe('/entrar: secrecy and a byte-identical sentence (D-302, T-09.1-71)', () => {
  it('without a link the card says exactly the sentence, whatever the record holds', async () => {
    mocks.fetch.mockImplementation(async () =>
      Response.json({
        ...publicTenant(null),
        outraComunidade: 'Rede Lab',
        email: 'ana@example.com',
      }),
    );
    await show({ erro: 'nao-liberado' });
    expect(screen.getByRole('alert').textContent).toBe(SENTENCE);
    expect(document.body.textContent).not.toContain('Rede Lab');
    expect(document.body.textContent).not.toMatch(/gateway|webhook|token|membership/i);
  });
});

/**
 * 09.2-21 (UI-D-542, A-UI-8, UI-D-547; E10; P104, P105) — the form steps aside for every held-out state of
 * the host, with the state's glyph and the state's two sentences; paused and unreachable read exactly as a
 * suspension. The five statuses of the closed set, one table.
 */
describe('/entrar: the held-out host cards (09.2-21)', () => {
  const SUSPENDED_TITLE = 'Comunidade indisponível';
  const SUSPENDED_BODY = 'Esta comunidade está temporariamente indisponível.';
  const UPDATING = [
    'Comunidade em atualização',
    'Estamos atualizando esta comunidade. Volte em alguns minutos.',
  ] as const;
  const PREPARING = [
    'Comunidade em preparação',
    'Esta comunidade ainda está sendo preparada. Volte em breve.',
  ] as const;

  const withStatus = (status: string) => ({
    ...tenantBrand,
    tenant: { slug: 'rede-demo', status },
  });

  it.each([
    ['suspended', SUSPENDED_TITLE, SUSPENDED_BODY, 'lucide-triangle-alert'],
    ['unavailable', SUSPENDED_TITLE, SUSPENDED_BODY, 'lucide-triangle-alert'],
    ['updating', UPDATING[0], UPDATING[1], 'lucide-refresh-cw'],
    ['preparing', PREPARING[0], PREPARING[1], 'lucide-hourglass'],
  ])(
    '%s renders the card instead of the form: "%s", glyph %s',
    async (status, title, body, glyph) => {
      mocks.brand = withStatus(status);
      await show({});
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeTruthy();
      expect(screen.getByText(body)).toBeTruthy();
      const svg = document.querySelector('h2')?.parentElement?.querySelector('svg');
      expect(svg?.classList.contains(glyph)).toBe(true);
      expect(svg?.getAttribute('width')).toBe('28');
      expect(svg?.getAttribute('class')).toContain('text-warning');
      // Nothing else of the form renders: no form, no inputs, no forgot link, no sign-up CTA.
      expect(document.querySelector('form')).toBeNull();
      expect(document.querySelector('input')).toBeNull();
      expect(screen.queryByRole('link')).toBeNull();
      expect(document.body.textContent).not.toMatch(
        /banco|projeto|esquema|migra[cç][aã]o|supabase|tenant/i,
      );
    },
  );

  it('active renders the form and no card', async () => {
    mocks.brand = withStatus('active');
    await show({});
    expect(document.querySelector('form')).not.toBeNull();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('paused and unreachable read byte-identically to a suspension (A-UI-8)', async () => {
    mocks.brand = withStatus('suspended');
    await show({});
    const suspended = document.body.innerHTML;
    cleanup();
    mocks.brand = withStatus('unavailable');
    await show({});
    expect(document.body.innerHTML).toBe(suspended);
  });

  it('P104: the card is a pure function of the status: a re-render and a second device read the same', async () => {
    mocks.brand = withStatus('updating');
    await show({});
    const first = document.body.innerHTML;
    cleanup();
    await show({});
    expect(document.body.innerHTML).toBe(first);
  });

  it('P105: a status change between two renders switches the card, and a cleared state brings the form back', async () => {
    mocks.brand = withStatus('updating');
    await show({});
    expect(screen.getByText(UPDATING[1])).toBeTruthy();
    cleanup();
    mocks.brand = withStatus('suspended');
    await show({});
    expect(screen.queryByText(UPDATING[1])).toBeNull();
    expect(screen.getByText(SUSPENDED_BODY)).toBeTruthy();
    cleanup();
    mocks.brand = withStatus('active');
    await show({});
    expect(document.querySelector('form')).not.toBeNull();
  });

  it('keeps the host line and the title above the card (E10: the long name still wraps)', async () => {
    mocks.brand = { ...withStatus('preparing'), displayName: 'A'.repeat(60) };
    await show({});
    const hint = screen.getByText(/A{60}/);
    expect(hint.className).toContain('break-words');
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });

  it('a generic or platform host never shows a held-out card', async () => {
    mocks.brand = { mode: 'platform', displayName: null, tenant: null, branding: {} };
    await show({});
    expect(document.querySelector('form')).not.toBeNull();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });
});
