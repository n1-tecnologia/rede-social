// @vitest-environment node

import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';

/**
 * 11-25 (MODER-04, MODER-05, D-732, UI-D-874): the queue's two server actions at the transport. The resolve action maps
 * the API's statuses and details to a CLOSED code (never an API message), validates with the contract's own Zod before
 * any request, sends the internal reason for a block only, and redirects a membership refusal OUTSIDE the try block.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

const mocks = vi.hoisted(() => ({
  fetchReports: vi.fn(),
  postReportResolve: vi.fn(),
  getBootstrap: vi.fn(),
}));

class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(`API ${status} ${code} a private api message`);
  }
}

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock('@/lib/bootstrap', () => ({
  ApiClientError,
  getBootstrap: () => mocks.getBootstrap(),
  bootstrapRedirectPath: (error: ApiClientError) =>
    error.code === 'MEMBERSHIP_BLOCKED' ? '/auth/blocked?t=Ana' : null,
}));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/reports', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reports')>()),
  fetchReports: (...args: unknown[]) => mocks.fetchReports(...args),
  postReportResolve: (...args: unknown[]) => mocks.postReportResolve(...args),
}));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});

const { loadMoreReportsAction, resolveReport } = await import('./actions');

const ID = '0b000000-0000-4000-8000-000000000001';

beforeEach(() => {
  mocks.fetchReports.mockReset();
  mocks.postReportResolve.mockReset();
  mocks.getBootstrap.mockReset();
  mocks.getBootstrap.mockResolvedValue({ tenant: { timezone: 'America/Sao_Paulo' } });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('resolveReport: the closed codes', () => {
  it("ok carries the report's new status and sends the verb once", async () => {
    mocks.postReportResolve.mockResolvedValue({ id: ID, status: 'dismissed' });
    const result = await resolveReport(ID, 'dismiss');
    expect(result).toEqual({ ok: true, code: 'ok', status: 'dismissed' });
    expect(mocks.postReportResolve).toHaveBeenCalledTimes(1);
    expect(mocks.postReportResolve).toHaveBeenCalledWith(ID, { resolution: 'dismiss' });
  });

  it('a block carries the trimmed internal reason, and only a block does', async () => {
    mocks.postReportResolve.mockResolvedValue({ id: ID, status: 'author_blocked' });
    await resolveReport(ID, 'block_author', '  ofensas repetidas  ');
    expect(mocks.postReportResolve).toHaveBeenLastCalledWith(ID, {
      resolution: 'block_author',
      reason: 'ofensas repetidas',
    });
    await resolveReport(ID, 'block_author', '   ');
    expect(mocks.postReportResolve).toHaveBeenLastCalledWith(ID, { resolution: 'block_author' });
    await resolveReport(ID, 'remove_content', 'não deve viajar');
    expect(mocks.postReportResolve).toHaveBeenLastCalledWith(ID, { resolution: 'remove_content' });
  });

  it.each([
    [
      'REPORT_ALREADY_RESOLVED',
      new ApiClientError(409, 'REPORT_ALREADY_RESOLVED'),
      'already_resolved',
    ],
    [
      'not_removable',
      new ApiClientError(409, 'CONFLICT', { report: 'not_removable' }),
      'not_removable',
    ],
    [
      'author_unavailable',
      new ApiClientError(409, 'CONFLICT', { report: 'author_unavailable' }),
      'author_unavailable',
    ],
    [
      'author_not_member',
      new ApiClientError(409, 'CONFLICT', { report: 'author_not_member' }),
      'author_unavailable',
    ],
    [
      'the member refusals',
      new ApiClientError(409, 'CONFLICT', { member: 'last_admin' }),
      'failed',
    ],
    ['a 404', new ApiClientError(404, 'NOT_FOUND'), 'failed'],
    ['a 500', new ApiClientError(500, 'INTERNAL'), 'failed'],
    ['a 401', new ApiClientError(401, 'UNAUTHENTICATED'), 'unauthenticated'],
    ['a lost permission', new ApiClientError(403, 'FORBIDDEN'), 'unauthenticated'],
  ])('%s reads as %s', async (_label, error, code) => {
    mocks.postReportResolve.mockRejectedValue(error);
    const result = await resolveReport(ID, 'remove_content');
    expect(result).toEqual({ ok: false, code });
    // never an API message, in the answer or in a log line
    expect(JSON.stringify(result)).not.toContain('private api message');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      'private api message',
    );
  });

  it('a network failure is a plain failure', async () => {
    mocks.postReportResolve.mockRejectedValue(new TypeError('fetch failed'));
    expect(await resolveReport(ID, 'dismiss')).toEqual({ ok: false, code: 'failed' });
  });

  it('a membership refusal is a navigation, outside the try block', async () => {
    mocks.postReportResolve.mockRejectedValue(new ApiClientError(403, 'MEMBERSHIP_BLOCKED'));
    await expect(resolveReport(ID, 'dismiss')).rejects.toThrow('REDIRECT:/auth/blocked?t=Ana');
  });

  it('refuses a malformed id, an unknown verb or an over-long reason before any request', async () => {
    expect(await resolveReport('not-a-uuid', 'dismiss')).toEqual({ ok: false, code: 'failed' });
    expect(await resolveReport(ID, 'delete_everything')).toEqual({ ok: false, code: 'failed' });
    expect(await resolveReport(ID, 'block_author', 'x'.repeat(501))).toEqual({
      ok: false,
      code: 'failed',
    });
    expect(await resolveReport(undefined, undefined)).toEqual({ ok: false, code: 'failed' });
    expect(mocks.postReportResolve).not.toHaveBeenCalled();
  });
});

const API_ITEM = {
  id: ID,
  createdAt: '2026-11-19T17:00:00.000000Z',
  subjectType: 'story',
  subjectId: ID,
  reason: 'spam',
  note: null,
  excerpt: 'Compre agora',
  status: 'open',
  resolvedAt: null,
  contentAvailable: true,
  reporter: { displayName: 'Larissa Souza', avatarAssetId: null },
  author: { displayName: 'Carla Nunes', avatarAssetId: null, isMember: true },
  ref: { storyId: ID },
};

describe('loadMoreReportsAction', () => {
  it('returns FINISHED rows for the estado and the opaque cursor', async () => {
    mocks.fetchReports.mockResolvedValue({ items: [API_ITEM], nextCursor: 'c2' });
    const page = await loadMoreReportsAction('c1', 'resolvidas');
    expect(mocks.fetchReports).toHaveBeenCalledWith({ estado: 'resolvidas', cursor: 'c1' });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.nextCursor).toBe('c2');
    const row = page.items[0];
    expect(row?.typePill).toBe('Story');
    expect(row?.statePill).toEqual({ label: 'Aberta', tone: 'neutral' });
    expect(row?.meta).toBe('Motivo: Spam ou propaganda · por Larissa Souza · 19/11/2026');
    expect(row?.viewHref).toBe(`/stories/${ID}`);
    expect(row?.resolve.rows.map((r) => r.kind)).toEqual(['dismiss', 'remove', 'block']);
    expect(row?.outcome.dismiss.label).toBe('Ignorada');
    expect(row?.outcome.remove_content.label).toBe('Conteúdo removido');
    expect(row?.outcome.block_author.label).toBe('Autor bloqueado');
  });

  it('refuses an unknown estado before any request', async () => {
    expect(await loadMoreReportsAction(null, 'bogus')).toEqual({ ok: false, code: 'generic' });
    expect(mocks.fetchReports).not.toHaveBeenCalled();
  });

  it('a 403 FORBIDDEN is "forbidden" and a failure is "generic"', async () => {
    mocks.fetchReports.mockRejectedValueOnce(new ApiClientError(403, 'FORBIDDEN'));
    expect(await loadMoreReportsAction(null, 'abertas')).toEqual({ ok: false, code: 'forbidden' });
    mocks.fetchReports.mockRejectedValueOnce(new Error('down'));
    expect(await loadMoreReportsAction(null, 'abertas')).toEqual({ ok: false, code: 'generic' });
  });

  it('a membership refusal is a navigation', async () => {
    mocks.fetchReports.mockRejectedValue(new ApiClientError(403, 'MEMBERSHIP_BLOCKED'));
    await expect(loadMoreReportsAction(null, 'abertas')).rejects.toThrow('REDIRECT:');
  });
});
