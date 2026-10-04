import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADDRESS_CAPS } from '@/lib/event-address';
import { createClient } from '@/lib/supabase/server';
import { GET } from './route';

/**
 * PDF item #10: `GET /api/cep/{cep}`, the event form's ViaCEP lookup behind this origin. The claims
 * worth a test are its gates (each an empty `no-store` body, with no upstream call), the mapping
 * (ViaCEP's `complemento` never leaves the route) and every failure becoming ONE answer the form
 * understands:
 *
 *  - C1: a cross-site request is 403, before any session read or upstream call;
 *  - C2: anything but 8 digits is 400, before the session and the upstream;
 *  - C3: no verified claims is 401, and ViaCEP is never asked;
 *  - C4: a known CEP is 200 `{ cep, street, district, city, state }`, privately cacheable for a
 *    day, asked ONCE at the fixed ViaCEP URL with a timeout signal, without the CEP-range note,
 *    and with every part cut to the form's cap;
 *  - C5: ViaCEP's unknown CEP (`erro` as the STRING "true", or a boolean) is 404;
 *  - C6: an upstream 500, the timeout, a body that is not JSON and an unknown shape are all 502,
 *    and no log line carries the CEP.
 *
 * What is stubbed: `lib/env`, the Supabase server client and `fetch`. What is real: the route,
 * `sameOriginGet` and `lib/viacep.ts`.
 */

vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));

const getClaims = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims } })),
}));

const fetchMock = vi.fn();
let errorSpy: ReturnType<typeof vi.spyOn>;

const CEP = '01310200';

/** ViaCEP's real answer for 01310-200 (curl, 2026-10-02). */
const PAULISTA = {
  cep: '01310-200',
  logradouro: 'Avenida Paulista',
  complemento: 'de 1512 a 2132 - lado par',
  unidade: '',
  bairro: 'Bela Vista',
  localidade: 'São Paulo',
  uf: 'SP',
  estado: 'São Paulo',
  regiao: 'Sudeste',
  ibge: '3550308',
  gia: '1004',
  ddd: '11',
  siafi: '7107',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function call(cep: string, site: string | null = 'same-origin') {
  const headers: Record<string, string> = { host: 'rede-demo.localhost:3000' };
  if (site !== null) headers['sec-fetch-site'] = site;
  const request = new Request(`http://rede-demo.localhost:3000/api/cep/${cep}`, { headers });
  return GET(request, { params: Promise.resolve({ cep }) });
}

beforeEach(() => {
  vi.mocked(createClient).mockClear();
  getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: 'u' } }, error: null });
  fetchMock.mockReset().mockResolvedValue(json(PAULISTA));
  vi.stubGlobal('fetch', fetchMock);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  errorSpy.mockRestore();
});

/** An empty refusal: the status, `no-store`, no body. */
async function expectEmpty(res: Response, status: number) {
  expect(res.status).toBe(status);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(await res.text()).toBe('');
}

describe('GET /api/cep/{cep}', () => {
  it.each([['cross-site'], ['same-site'], ['none']])(
    'C1: Sec-Fetch-Site %s is 403, with no session read and no upstream call',
    async (site) => {
      await expectEmpty(await call(CEP, site), 403);
      expect(createClient).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([['0131020'], ['013102000'], ['01310-200'], ['abcdefgh'], ['']])(
    'C2: "%s" is 400, before the session and the upstream',
    async (cep) => {
      await expectEmpty(await call(cep), 400);
      expect(createClient).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('C3: without verified claims it is 401, and ViaCEP is never asked', async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error('no session') });
    await expectEmpty(await call(CEP), 401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('C4: a known CEP is the mapped address, privately cacheable, without the CEP-range note', async () => {
    const res = await call(CEP);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=86400');
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({
      cep: CEP,
      street: 'Avenida Paulista',
      district: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
    });
    expect(body).not.toContain('lado par');
    expect(body).not.toContain('complemento');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://viacep.com.br/ws/01310200/json/');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('C4: a city-wide CEP answers an empty street and district, never an invented one', async () => {
    fetchMock.mockResolvedValue(
      json({
        ...PAULISTA,
        cep: '78175-000',
        logradouro: '',
        bairro: '',
        localidade: 'Poconé',
        uf: 'MT',
      }),
    );
    const res = await call('78175000');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      cep: '78175000',
      street: '',
      district: '',
      city: 'Poconé',
      state: 'MT',
    });
  });

  it('C4: a part longer than the form’s cap is cut to it, so the composed address stays bounded', async () => {
    fetchMock.mockResolvedValue(
      json({ ...PAULISTA, logradouro: 'R'.repeat(140), bairro: 'B'.repeat(90) }),
    );
    const body = (await (await call(CEP)).json()) as { street: string; district: string };
    expect(body.street).toBe('R'.repeat(ADDRESS_CAPS.street));
    expect(body.district).toBe('B'.repeat(ADDRESS_CAPS.district));
  });

  it.each([[{ erro: 'true' }], [{ erro: true }]])(
    'C5: ViaCEP’s unknown CEP %j is 404',
    async (body) => {
      fetchMock.mockResolvedValue(json(body));
      await expectEmpty(await call('99999999'), 404);
    },
  );

  it.each([
    ['an upstream 500', () => fetchMock.mockResolvedValue(json({}, 500))],
    [
      'the timeout',
      () =>
        fetchMock.mockRejectedValue(
          new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
        ),
    ],
    [
      'a body that is not JSON',
      () => fetchMock.mockResolvedValue(new Response('<html>', { status: 200 })),
    ],
    ['an unknown shape', () => fetchMock.mockResolvedValue(json({ ...PAULISTA, uf: 'XX' }))],
  ])('C6: %s is 502, and no log line carries the CEP', async (_, arrange) => {
    arrange();
    await expectEmpty(await call(CEP), 502);
    expect(errorSpy).toHaveBeenCalled();
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(CEP);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('01310-200');
  });
});
