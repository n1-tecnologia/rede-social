// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filenameFromDisposition, startCsvDownload } from './download';

/**
 * 12-17 Task 1 (D-595, T-12-37): the client half of the CSV download. `fetch`, `URL.createObjectURL` and
 * the temporary anchor are mocked: success saves under the API's file name and revokes the object URL, a
 * 403, a 5xx and a network error come back as `{ ok: false }` with nothing saved, and the bytes are never
 * handed to any storage.
 */

const DISPOSITION = 'attachment; filename="respostas-perfil-2026-10-30.csv"';

let create: ReturnType<typeof vi.fn>;
let revoke: ReturnType<typeof vi.fn>;
let click: ReturnType<typeof vi.spyOn>;
let anchors: HTMLAnchorElement[];

beforeEach(() => {
  create = vi.fn(() => 'blob:fake-url');
  revoke = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true });
  anchors = [];
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    anchors.push(this);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('startCsvDownload', () => {
  it('fetches the handler, saves under the API’s file name and revokes the object URL', async () => {
    const fetchMock = stubFetch(
      new Response('Nome;E-mail\r\n', {
        status: 200,
        headers: { 'content-type': 'text/csv', 'content-disposition': DISPOSITION },
      }),
    );
    const result = await startCsvDownload('/api/profile-form/export');
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/profile-form/export', {
      credentials: 'same-origin',
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(anchors[0]?.download).toBe('respostas-perfil-2026-10-30.csv');
    expect(anchors[0]?.getAttribute('href')).toBe('blob:fake-url');
    expect(revoke).toHaveBeenCalledWith('blob:fake-url');
    // The anchor is temporary: nothing is left in the document.
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('falls back to respostas-perfil.csv when the header is missing', async () => {
    stubFetch(new Response('a;b\r\n', { status: 200 }));
    await startCsvDownload('/api/profile-form/export');
    expect(anchors[0]?.download).toBe('respostas-perfil.csv');
  });

  it('returns { ok: false, status: 403 } for a refusal and saves nothing', async () => {
    stubFetch(new Response(null, { status: 403 }));
    const result = await startCsvDownload('/api/profile-form/export');
    expect(result).toEqual({ ok: false, status: 403 });
    expect(create).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('returns { ok: false, status: 502 } for a relay failure', async () => {
    stubFetch(new Response(null, { status: 502 }));
    expect(await startCsvDownload('/api/profile-form/export')).toEqual({ ok: false, status: 502 });
    expect(click).not.toHaveBeenCalled();
  });

  it('returns { ok: false, status: null } for a network error', async () => {
    stubFetch(new TypeError('Failed to fetch'));
    expect(await startCsvDownload('/api/profile-form/export')).toEqual({
      ok: false,
      status: null,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('never touches a storage API with the file', async () => {
    const setLocal = vi.spyOn(Storage.prototype, 'setItem');
    stubFetch(
      new Response('a;b\r\n', { status: 200, headers: { 'content-disposition': DISPOSITION } }),
    );
    await startCsvDownload('/api/profile-form/export');
    expect(setLocal).not.toHaveBeenCalled();
  });
});

describe('filenameFromDisposition', () => {
  it('reads a quoted and an unquoted name', () => {
    expect(filenameFromDisposition('attachment; filename="respostas-perfil-2026-10-30.csv"')).toBe(
      'respostas-perfil-2026-10-30.csv',
    );
    expect(filenameFromDisposition('attachment; filename=export.csv')).toBe('export.csv');
  });

  it('reads the RFC 5987 form', () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''respostas-2026.csv")).toBe(
      'respostas-2026.csv',
    );
  });

  it('refuses a path, a non-csv name and a missing header', () => {
    expect(filenameFromDisposition('attachment; filename="../../etc/passwd"')).toBe(
      'respostas-perfil.csv',
    );
    expect(filenameFromDisposition('attachment; filename="a.exe"')).toBe('respostas-perfil.csv');
    expect(filenameFromDisposition(null)).toBe('respostas-perfil.csv');
    expect(filenameFromDisposition('inline')).toBe('respostas-perfil.csv');
  });
});
