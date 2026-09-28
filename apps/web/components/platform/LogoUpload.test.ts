// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrandingView } from '@/lib/branding-view';
import { uploadToSignedUrl } from '@/lib/upload';
import { type UploadActions, useSignedUpload } from './LogoUpload';

/**
 * WR-07 / UI-SPEC E14 "Error state — upload": a REJECTED server action (network drop, 5xx from the
 * Next function, a throw inside the action) or a thrown transfer must return the zone to idle with
 * the generic pt-BR message, log `platform.branding.upload_failed`, and accept the next drop — never
 * strand `busy` / `progress` until a reload. The real hook runs under happy-dom through `renderHook`;
 * `classifyFile` / `resolveMime` are real, only the XHR PUT and the two actions are stubbed.
 */
const { toast } = vi.hoisted(() => ({ toast: { show: vi.fn() } }));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));
vi.mock('@/lib/upload', async (orig) => ({
  ...(await orig<typeof import('@/lib/upload')>()),
  uploadToSignedUrl: vi.fn(),
}));

const put = vi.mocked(uploadToSignedUrl);

const view = { displayName: 'Acme', logoUrl: 'http://storage.test/logo.png' } as BrandingView;
const file = () => new File([new Uint8Array(16)], 'logo.png', { type: 'image/png' });
const startOk = {
  ok: true as const,
  upload: { uploadId: 'u1', signedUrl: 'http://storage.test/put', maxBytes: 2_097_152 },
};

let actions: { start: ReturnType<typeof vi.fn>; complete: ReturnType<typeof vi.fn> };
let onCompleted: ReturnType<typeof vi.fn<(view: BrandingView) => void>>;
let errorSpy: ReturnType<typeof vi.spyOn>;

const mount = () =>
  renderHook(() =>
    useSignedUpload({
      tenantId: 't',
      kind: 'logo',
      actions: actions as unknown as UploadActions,
      onCompleted,
    }),
  );

beforeEach(() => {
  actions = { start: vi.fn(), complete: vi.fn() };
  onCompleted = vi.fn<(view: BrandingView) => void>();
  toast.show.mockReset();
  put.mockReset();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  errorSpy.mockRestore();
});

describe('useSignedUpload — a rejected step returns the zone to idle (WR-07)', () => {
  it('1. actions.start rejects → idle, progress 0, errors.generic, logged; nothing completed', async () => {
    actions.start.mockRejectedValueOnce(new Error('boom'));
    const { result } = mount();

    await expect(
      act(async () => {
        await result.current.onFile(file());
      }),
    ).resolves.toBeUndefined();

    expect(result.current.state).toBe('idle');
    expect(result.current.progress).toBe(0);
    expect(result.current.error).toBe('errors.generic');
    expect(errorSpy).toHaveBeenCalledWith(
      'platform.branding.upload_failed',
      expect.objectContaining({ kind: 'logo', error: expect.stringContaining('boom') }),
    );
    expect(onCompleted).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('2. the second drop after a rejected start is accepted and completes', async () => {
    actions.start.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(startOk);
    put.mockResolvedValue({ ok: true });
    actions.complete.mockResolvedValue({ ok: true, view });
    const { result } = mount();

    await act(async () => {
      await result.current.onFile(file()).catch(() => {});
    });
    expect(result.current.state).toBe('idle');

    await act(async () => {
      await result.current.onFile(file());
    });

    expect(actions.start).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenCalledTimes(1);
    expect(actions.complete).toHaveBeenCalledWith('t', 'u1');
    expect(result.current.state).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(onCompleted).toHaveBeenCalledWith(view);
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
  });

  it('3a. actions.complete rejects → idle + errors.generic', async () => {
    actions.start.mockResolvedValue(startOk);
    put.mockResolvedValue({ ok: true });
    actions.complete.mockRejectedValueOnce(new Error('complete-boom'));
    const { result } = mount();

    await expect(
      act(async () => {
        await result.current.onFile(file());
      }),
    ).resolves.toBeUndefined();

    expect(result.current.state).toBe('idle');
    expect(result.current.progress).toBe(0);
    expect(result.current.error).toBe('errors.generic');
    expect(errorSpy).toHaveBeenCalledWith(
      'platform.branding.upload_failed',
      expect.objectContaining({ error: expect.stringContaining('complete-boom') }),
    );
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it('3b. a thrown transfer → idle + errors.generic', async () => {
    actions.start.mockResolvedValue(startOk);
    put.mockRejectedValueOnce(new Error('xhr-boom'));
    const { result } = mount();

    await expect(
      act(async () => {
        await result.current.onFile(file());
      }),
    ).resolves.toBeUndefined();

    expect(result.current.state).toBe('idle');
    expect(result.current.error).toBe('errors.generic');
    expect(actions.complete).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      'platform.branding.upload_failed',
      expect.objectContaining({ error: expect.stringContaining('xhr-boom') }),
    );
  });
});
