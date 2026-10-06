import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { join } from './actions';

/**
 * WINDOWS #75 (08.1-03) — `/participar`'s `join` action on a refusal.
 *
 * A server action that `redirect()`s to the `/auth/blocked` or `/auth/suspended` route handler reaches
 * it through the router's fetch, so the handler's own sign-out cookie clear never reaches the browser
 * (found by 08.1-02 on `joinFromSignup`). The claim pinned here: on MEMBERSHIP_BLOCKED and
 * TENANT_SUSPENDED the action itself signs out, LOCALLY (`scope: 'local'`, never global — a session the
 * person holds on another community's address must survive), and does so BEFORE the redirect. Every
 * other outcome keeps the session: a join, the invite hand-off, stale consents, the refused card
 * (which offers its own "Sair") and a failure.
 *
 * Stubbed: `lib/env`, `lib/api`'s `apiFetch`, `lib/supabase/server`, `next/headers`, `next/navigation`.
 * Real: the form schema and the outcome mapping.
 */

const calls: string[] = [];
const signOut = vi.fn(async (options: { scope: string }) => {
  calls.push(`signOut:${options.scope}`);
  return { error: null };
});

vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { signOut } })),
}));

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    calls.push(`redirect:${path}`);
    throw new Error(`redirect:${path}`);
  }),
}));

function form(): FormData {
  const data = new FormData();
  data.set('name', 'Nome no Lab');
  data.set('rulesVersion', '1');
  data.set('termsVersion', '1');
  data.set('acceptRules', 'on');
  data.set('acceptTerms', 'on');
  return data;
}

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const envelope = (code: string, details?: Record<string, unknown>) => ({
  error: { code, message: 'x', ...(details ? { details } : {}) },
});

async function run(res: Response): Promise<string[]> {
  vi.mocked(apiFetch).mockResolvedValueOnce(res);
  await expect(join(form())).rejects.toThrow(/^redirect:/);
  return calls;
}

beforeEach(() => {
  calls.length = 0;
  signOut.mockClear();
  vi.mocked(apiFetch).mockReset();
});

describe('participar join: the refusals that end the session here (WINDOWS #75)', () => {
  it('MEMBERSHIP_BLOCKED signs out locally, then goes to the blocked screen of THIS community', async () => {
    expect(
      await run(answer(403, envelope('MEMBERSHIP_BLOCKED', { tenantName: 'Rede Lab' }))),
    ).toEqual(['signOut:local', 'redirect:/auth/blocked?t=Rede%20Lab']);
  });

  it('TENANT_SUSPENDED signs out locally, then goes to the suspended screen', async () => {
    expect(
      await run(answer(403, envelope('TENANT_SUSPENDED', { tenantName: 'Rede Lab' }))),
    ).toEqual(['signOut:local', 'redirect:/auth/suspended']);
  });

  it('a failed local sign-out still redirects to the refusal screen (the handler retries it)', async () => {
    signOut.mockImplementationOnce(async (options: { scope: string }) => {
      calls.push(`signOut:${options.scope}`);
      return { error: new Error('boom') } as never;
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(
      await run(answer(403, envelope('MEMBERSHIP_BLOCKED', { tenantName: 'Rede Lab' }))),
    ).toEqual(['signOut:local', 'redirect:/auth/blocked?t=Rede%20Lab']);
    spy.mockRestore();
  });
});

describe('participar join: every other outcome keeps the session', () => {
  it.each([
    ['joined', answer(200, { outcome: 'joined', tenantSlug: 'rede-lab' }), '/inicio'],
    [
      'invite pending',
      answer(409, envelope('INVITE_STATE_INVALID', { reason: 'invite_pending' })),
      '/aceitar-convite',
    ],
    [
      'stale consents',
      answer(400, envelope('VALIDATION_FAILED', { consents: 'stale' })),
      '/participar?erro=consentimento',
    ],
    ['refused', answer(403, envelope('FORBIDDEN')), '/participar?erro=recusado'],
    ['a server failure', answer(500, envelope('INTERNAL')), '/participar?erro=falha'],
  ])('%s', async (_label, res, target) => {
    expect(await run(res)).toEqual([`redirect:${target}`]);
    expect(signOut).not.toHaveBeenCalled();
  });
});
