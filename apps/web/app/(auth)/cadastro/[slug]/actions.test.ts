import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeJoinDraft } from '@/lib/join-draft';
import { writePendingConfirmation } from '@/lib/pending-confirmation';
import { sendSignupConfirmation } from '@/lib/signup-confirmation';
import { getHostTenant } from '@/lib/tenant-host';
import { joinFromSignup, signup } from './actions';

/**
 * 09.2-17 (D-36, D-538, decision 4): the sign-up of `/cadastro/{slug}` on a GENERIC host. The central
 * Auth cannot sign anybody in to a tenant of another project, so the person is sent to that tenant's own
 * primary host (`https://<primaryHost>/entrar`) and nothing is sent or remembered from here; a tenant of
 * the central project keeps today's flow. On the tenant's own host the action is unchanged (its Auth
 * client follows the host's coordinates inside `createClient`).
 *
 * Stubbed: env, the host classification, the cookies/mail helpers, `next/navigation` and `fetch`.
 */
vi.mock('@/lib/env', () => ({ env: { API_URL: 'http://api.test' } }));
vi.mock('@/lib/tenant-host', () => ({
  getHostTenant: vi.fn(),
  signupPath: (t: { mode: string }, slug: string) =>
    t.mode === 'tenant' ? '/cadastro' : `/cadastro/${slug}`,
}));
const brandStatus = vi.hoisted(() => ({ value: 'active' as string | undefined }));
vi.mock('@/lib/host-brand', () => ({
  getHostBrand: async () => ({
    tenant: brandStatus.value === undefined ? null : { status: brandStatus.value },
  }),
}));
vi.mock('@/lib/join-draft', () => ({
  writeJoinDraft: vi.fn(),
  readJoinDraft: vi.fn(),
  clearJoinDraft: vi.fn(),
}));
vi.mock('@/lib/pending-confirmation', () => ({
  writePendingConfirmation: vi.fn(),
  isEmailNotConfirmed: vi.fn(() => false),
}));
vi.mock('@/lib/signup-confirmation', () => ({ sendSignupConfirmation: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetchWithToken: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('notFound');
  }),
}));

const fetchMock = vi.fn();

const tenantRecord = {
  slug: 'rede-b',
  displayName: 'Rede B',
  rulesText: 'x',
  rulesVersion: 1,
  termsVersion: 1,
};
const foreignRecord = {
  ...tenantRecord,
  supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
  publishableKey: 'pk-b',
  primaryHost: 'comunidade.cliente.com.br',
};

function form(): FormData {
  const data = new FormData();
  data.set('slug', 'rede-b');
  data.set('name', 'Maria Souza');
  data.set('email', 'maria@example.com');
  data.set('password', 'Segredo123');
  data.set('rulesVersion', '1');
  data.set('termsVersion', '1');
  data.set('acceptRules', 'on');
  data.set('acceptTerms', 'on');
  return data;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** `GET /v1/public/tenants/{slug}` answers `record`; `POST /v1/public/signup/{slug}` answers `post`. */
function api(record: Response, post: Response) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST' ? post : record,
  );
}

async function run(): Promise<string> {
  try {
    await signup(form());
  } catch (error) {
    return (error as Error).message;
  }
  return 'returned';
}

beforeEach(() => {
  brandStatus.value = 'active';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(getHostTenant).mockResolvedValue({ mode: 'generic', host: 'localhost' });
  vi.mocked(writeJoinDraft).mockClear();
  vi.mocked(writePendingConfirmation).mockClear();
  vi.mocked(sendSignupConfirmation).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signup on a generic host (09.2-17)', () => {
  it('a tenant of another project: the account is created, then the person goes to ITS host; nothing is sent from here', async () => {
    api(json(200, foreignRecord), json(201, { userId: crypto.randomUUID(), tenantSlug: 'rede-b' }));
    expect(await run()).toBe('redirect:https://comunidade.cliente.com.br/entrar');
    expect(sendSignupConfirmation).not.toHaveBeenCalled();
    expect(writePendingConfirmation).not.toHaveBeenCalled();
  });

  it('an existing identity of that tenant also goes to its host, with no "já tem conta" draft', async () => {
    api(json(200, foreignRecord), json(409, { error: { code: 'CONFLICT', message: 'x' } }));
    expect(await run()).toBe('redirect:https://comunidade.cliente.com.br/entrar');
    expect(writeJoinDraft).not.toHaveBeenCalled();
  });

  it('a refused sign-up (validation) is not turned into a redirect to the tenant host', async () => {
    api(json(200, foreignRecord), json(400, { error: { code: 'VALIDATION', message: 'x' } }));
    expect(await run()).toBe('redirect:/cadastro/rede-b?erro=validacao');
  });

  it('a record the contract cannot read (a primary host that is not a host) is a 404, never the central flow', async () => {
    api(
      json(200, { ...foreignRecord, primaryHost: 'evil.example/@x' }),
      json(201, { userId: crypto.randomUUID(), tenantSlug: 'rede-b' }),
    );
    expect(await run()).toBe('notFound');
    expect(sendSignupConfirmation).not.toHaveBeenCalled();
  });

  it("a tenant of the central project keeps today's flow: confirmation mail, then /verifique-seu-email", async () => {
    api(json(200, tenantRecord), json(201, { userId: crypto.randomUUID(), tenantSlug: 'rede-b' }));
    expect(await run()).toBe('redirect:/verifique-seu-email');
    expect(writePendingConfirmation).toHaveBeenCalledTimes(1);
    expect(sendSignupConfirmation).toHaveBeenCalledWith('maria@example.com');
  });

  it("an unreadable record falls back to today's flow and lets the POST decide", async () => {
    api(json(500, {}), json(404, { error: { code: 'TENANT_NOT_FOUND', message: 'x' } }));
    expect(await run()).toBe('notFound');
  });
});

describe("signup on the tenant's own host (09.2-17)", () => {
  it('does not look the record up and keeps the confirmation flow (its Auth client follows the host)', async () => {
    vi.mocked(getHostTenant).mockResolvedValue({
      mode: 'tenant',
      host: 'comunidade.cliente.com.br',
      slug: 'rede-b',
      displayName: 'Rede B',
    });
    api(json(200, foreignRecord), json(201, { userId: crypto.randomUUID(), tenantSlug: 'rede-b' }));
    expect(await run()).toBe('redirect:/verifique-seu-email');
    expect(fetchMock.mock.calls.filter(([, init]) => !init?.method)).toHaveLength(0);
    expect(sendSignupConfirmation).toHaveBeenCalledTimes(1);
  });
});

describe('sign-up and join on a held-out host (09.2-21, UI-D-542)', () => {
  it.each([
    ['suspended', '/comunidade-indisponivel'],
    ['unavailable', '/comunidade-indisponivel'],
    ['updating', '/comunidade-em-atualizacao'],
    ['preparing', '/comunidade-em-preparacao'],
  ])('%s: the sign-up redirects to %s before any request, mail or draft', async (status, path) => {
    brandStatus.value = status;
    api(json(200, tenantRecord), json(201, { userId: crypto.randomUUID(), tenantSlug: 'rede-b' }));
    expect(await run()).toBe(`redirect:${path}`);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendSignupConfirmation).not.toHaveBeenCalled();
    expect(writePendingConfirmation).not.toHaveBeenCalled();
    expect(writeJoinDraft).not.toHaveBeenCalled();
  });

  it('the join with an existing password is refused the same way, before the password is proven', async () => {
    brandStatus.value = 'updating';
    const data = form();
    let message = 'returned';
    try {
      await joinFromSignup(data);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe('redirect:/comunidade-em-atualizacao');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['TENANT_UPDATING', '/comunidade-em-atualizacao'],
    ['TENANT_PREPARING', '/comunidade-em-preparacao'],
    ['TENANT_UNAVAILABLE', '/comunidade-indisponivel'],
  ])(
    'a generic host: the slug route answering 503 %s sends the person to %s and creates nothing',
    async (code, path) => {
      brandStatus.value = undefined;
      api(
        json(200, tenantRecord),
        json(503, { error: { code, message: 'x', requestId: 'req-1' } }),
      );
      expect(await run()).toBe(`redirect:${path}`);
      expect(sendSignupConfirmation).not.toHaveBeenCalled();
      expect(writePendingConfirmation).not.toHaveBeenCalled();
    },
  );

  it('an active host keeps the shipped flow', async () => {
    api(json(200, tenantRecord), json(201, { userId: crypto.randomUUID(), tenantSlug: 'rede-b' }));
    expect(await run()).toBe('redirect:/verifique-seu-email');
  });
});
