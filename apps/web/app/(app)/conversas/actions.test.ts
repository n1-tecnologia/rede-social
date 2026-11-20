import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { sendDirectMessage } from './actions';

/**
 * 11-22 (CHAT-06, D-720, D-722; T-11-03, T-11-06) — the direct conversation's server actions. A server action is a
 * public endpoint, so the claims worth a test are: the input is validated by the SAME strict Zod the API uses
 * BEFORE any request; the argument object sent to the API is exactly `{ toMembershipId, body }` and nothing else;
 * every API refusal becomes ONE closed code the pane maps to its own sentence (the neutral `closed` carries no
 * name, no reason); the answer is a FINISHED view in which the other side's bubble is the other side's.
 *
 * What is stubbed: `lib/env`, the transport (`apiFetch`), `getBootstrap` (the tenant zone), `next/navigation` and
 * the translator (the REAL pt-BR catalog). What is real: the action, the loader, the contracts and the view
 * functions.
 */

vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

vi.mock('@/lib/bootstrap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bootstrap')>()),
  getBootstrap: vi.fn(async () => ({
    tenant: { timezone: 'America/Sao_Paulo' },
    permissions: ['chat.direct'],
  })),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages();
  return {
    getTranslations: vi.fn(async (namespace: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace } as never),
    ),
  };
});

const CONVERSATION = '0c000000-0000-4000-8000-0000000000c1';
const OTHER = '0e000000-0000-4000-8000-0000000000e1';
const MESSAGE = '0d000000-0000-4000-8000-0000000000d1';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const refusal = (status: number, code: string, chat?: string): Response =>
  json(status, { error: { code, ...(chat ? { details: { chat } } : {}) } });

const sentBody = (n = 0): unknown => {
  const init = vi.mocked(apiFetch).mock.calls[n]?.[1] as RequestInit | undefined;
  return init?.body ? JSON.parse(String(init.body)) : undefined;
};

const stored = (over: Record<string, unknown> = {}) => ({
  conversationId: CONVERSATION,
  created: true,
  message: {
    id: MESSAGE,
    seq: 1,
    side: 'member',
    body: 'Oi',
    createdAt: '2026-11-19T17:12:00.000000Z',
    author: null,
    authorIsViewer: true,
    ...over,
  },
});

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('sendDirectMessage (D-720)', () => {
  it('sends exactly { toMembershipId, body } and answers the finished view, the conversation and `created`', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(201, stored()));
    const result = await sendDirectMessage(OTHER, '  Oi  ');

    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe('/v1/chat/direct/messages');
    expect(sentBody()).toEqual({ toMembershipId: OTHER, body: 'Oi' });
    expect(result).toMatchObject({
      ok: true,
      conversationId: CONVERSATION,
      created: true,
      view: { id: MESSAGE, seq: 1, side: 'own', body: 'Oi', time: '14:12', label: null },
    });
  });

  it('refuses at the server, before any request, what the API would refuse (strict contract)', async () => {
    for (const [to, body] of [
      ['not-a-uuid', 'Oi'],
      [OTHER, ''],
      [OTHER, '   '],
      [OTHER, 'x'.repeat(2001)],
      [undefined, 'Oi'],
      [OTHER, 42],
    ] as const) {
      await expect(sendDirectMessage(to, body)).resolves.toEqual({ ok: false, error: 'invalid' });
    }
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('counts a body of 2000 code points (emoji included) as valid, as the API does', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(201, stored()));
    const body = '😀'.repeat(2000);
    const result = await sendDirectMessage(OTHER, body);
    expect(result.ok).toBe(true);
    expect(sentBody()).toEqual({ toMembershipId: OTHER, body });
  });

  it('maps every refusal to ONE closed code, and a closed pair says nothing else', async () => {
    const cases: [Response, string][] = [
      [refusal(409, 'CONFLICT', 'direct_closed'), 'closed'],
      [refusal(409, 'CONFLICT'), 'failed'],
      [refusal(404, 'NOT_FOUND'), 'not_found'],
      [refusal(429, 'RATE_LIMITED'), 'rate_limited'],
      [refusal(400, 'VALIDATION_FAILED'), 'invalid'],
      [refusal(500, 'INTERNAL'), 'failed'],
    ];
    for (const [response, code] of cases) {
      vi.mocked(apiFetch).mockResolvedValueOnce(response);
      const result = await sendDirectMessage(OTHER, 'Oi');
      expect(result).toEqual({ ok: false, error: code });
    }
  });

  it('a transport failure and a non-conforming answer are the plain failure, never an API message', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('boom'));
    await expect(sendDirectMessage(OTHER, 'Oi')).resolves.toEqual({ ok: false, error: 'failed' });
    vi.mocked(apiFetch).mockResolvedValueOnce(json(201, { ...stored(), extra: 'x' }));
    await expect(sendDirectMessage(OTHER, 'Oi')).resolves.toEqual({ ok: false, error: 'failed' });
  });

  it('a 401 or a 403 the bootstrap knows becomes a navigation (outside the try), never a result', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(refusal(401, 'UNAUTHENTICATED'));
    await expect(sendDirectMessage(OTHER, 'Oi')).rejects.toThrow('redirect:/entrar');
    vi.mocked(apiFetch).mockResolvedValueOnce(refusal(403, 'TENANT_HOST_MISMATCH'));
    await expect(sendDirectMessage(OTHER, 'Oi')).rejects.toThrow(/^redirect:/);
  });

  it('logs the shape only: no body, no id, no name', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(refusal(409, 'CONFLICT', 'direct_closed'));
    await sendDirectMessage(OTHER, 'segredo que não deve ir para o log');
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain('chat.direct_send_failed');
    expect(logged).not.toContain('segredo');
    expect(logged).not.toContain(OTHER);
  });
});
