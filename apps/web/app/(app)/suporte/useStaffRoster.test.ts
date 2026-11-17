// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStaffRoster } from './useStaffRoster';

/**
 * 12.4-14 Task 2 (UI-D-823, UI-D-827, sketch 023 outcome 7; UC S11 and S03 loading; T-12.4-65): ONE names-only
 * staff list. A single fetch of `GET /api/chat/staff` is shared by every consumer mounted at the same time
 * (the "Responsável" sheet here and the "Atribuir" sheet of plan 15), loads on demand, keeps user id and
 * name only, and a failed read can be retried.
 */

const fetchMock = vi.fn();

const ANA = { userId: '11111111-1111-4111-8111-111111111111', name: 'Ana Souza' };
const BRUNO = { userId: '22222222-2222-4222-8222-222222222222', name: 'Bruno' };

const staffCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url) === '/api/chat/staff').length;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => Response.json({ items: [ANA, BRUNO] }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useStaffRoster', () => {
  it('reads nothing until a consumer asks (the sheet is closed)', () => {
    const { result } = renderHook(() => useStaffRoster());
    expect(result.current.status).toBe('idle');
    expect(result.current.items).toEqual([]);
    expect(staffCalls()).toBe(0);
  });

  it('loads on demand: loading, then the names in the order the API gave them', async () => {
    let release: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    const { result } = renderHook(() => useStaffRoster());
    act(() => result.current.load());
    expect(result.current.status).toBe('loading');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/staff',
      expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }),
    );
    await act(async () => release(Response.json({ items: [ANA, BRUNO] })));
    expect(result.current.status).toBe('ready');
    expect(result.current.items).toEqual([ANA, BRUNO]);
  });

  it('one fetch for any number of consumers mounted together', async () => {
    const first = renderHook(() => useStaffRoster());
    const second = renderHook(() => useStaffRoster());
    act(() => {
      first.result.current.load();
      second.result.current.load();
      first.result.current.load();
    });
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    expect(second.result.current.status).toBe('ready');
    expect(second.result.current.items).toEqual([ANA, BRUNO]);
    expect(staffCalls()).toBe(1);
  });

  it('a later consumer of a roster that is already read does not fetch again', async () => {
    const first = renderHook(() => useStaffRoster());
    act(() => first.result.current.load());
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    const second = renderHook(() => useStaffRoster());
    act(() => second.result.current.load());
    expect(second.result.current.status).toBe('ready');
    expect(staffCalls()).toBe(1);
  });

  it('keeps names only: user id and name, nothing else the answer carried (T-12.4-65)', async () => {
    fetchMock.mockImplementationOnce(async () =>
      Response.json({
        items: [
          { ...ANA, email: 'ana@exemplo.com', role: 'admin_tenant', phone: '+5511' },
          { userId: 'not-a-uuid-but-a-string', name: 42 },
          { name: 'Sem id' },
          null,
        ],
      }),
    );
    const { result } = renderHook(() => useStaffRoster());
    act(() => result.current.load());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items).toEqual([ANA]);
    expect(JSON.stringify(result.current)).not.toContain('ana@exemplo.com');
  });

  it('a failed read is an error state, and retry reads again', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 500 }));
    const { result } = renderHook(() => useStaffRoster());
    act(() => result.current.load());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.items).toEqual([]);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items).toEqual([ANA, BRUNO]);
    expect(staffCalls()).toBe(2);
  });

  it('a network failure is the same error state, never a throw', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('offline');
    });
    const { result } = renderHook(() => useStaffRoster());
    act(() => result.current.load());
    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  it('load() while loading or ready does not fetch again; after an error it does not either (retry does)', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 503 }));
    const { result } = renderHook(() => useStaffRoster());
    act(() => result.current.load());
    act(() => result.current.load());
    await waitFor(() => expect(result.current.status).toBe('error'));
    act(() => result.current.load());
    expect(staffCalls()).toBe(1);
  });

  it('the roster is forgotten when the last consumer unmounts, so the next one reads a fresh list', async () => {
    const first = renderHook(() => useStaffRoster());
    act(() => first.result.current.load());
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    first.unmount();
    const second = renderHook(() => useStaffRoster());
    expect(second.result.current.status).toBe('idle');
    act(() => second.result.current.load());
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    expect(staffCalls()).toBe(2);
  });
});
