// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import type { MediaAsset } from '@tria/contracts/media';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeMediaUploadAction, startMediaUploadAction } from '@/app/(app)/perfil/actions';
import { normaliseImage, uploadBytes } from '@/lib/upload';
import { useSignedUpload } from './useSignedUpload';

/**
 * The photo field's behaviour, exercised through the state machine it renders (`useSignedUpload`) —
 * the `LogoUpload.test.ts` pattern, one level down. The catalog is the REAL `media.json`, so an
 * assertion here fails when the pt-BR copy drifts, and `{limit}` is proven to interpolate rather
 * than to ship a hard-coded number (UI-D-05).
 *
 * What is stubbed: the two server actions, the transfer and the browser re-encode. What is real: the
 * hook, the refusal→copy map and the `busy` one-in-flight rule.
 */

const { catalog, toast } = await vi.hoisted(async () => {
  // `vi.hoisted` runs BEFORE the imports it feeds, so `node:fs` is loaded here rather than above.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  // `process.cwd()` is the package root under vitest; `import.meta.url` is not a file URL under
  // happy-dom, whose document origin rewrites it.
  const file = join(process.cwd(), 'messages', 'pt-BR', 'media.json');
  return {
    catalog: JSON.parse(readFileSync(file, 'utf8')).media as Record<string, unknown>,
    toast: { show: vi.fn(), dismiss: vi.fn() },
  };
});

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    const raw = key
      .split('.')
      .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog);
    return String(raw ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
      String(values?.[name] ?? ''),
    );
  },
}));

vi.mock('@tria/ui', async (orig) => ({
  ...(await orig<typeof import('@tria/ui')>()),
  useToast: () => toast,
}));

vi.mock('@/app/(app)/perfil/actions', () => ({
  startMediaUploadAction: vi.fn(),
  completeMediaUploadAction: vi.fn(),
  setAvatarAction: vi.fn(),
  removeAvatarAction: vi.fn(),
}));

vi.mock('@/lib/upload', async (orig) => ({
  ...(await orig<typeof import('@/lib/upload')>()),
  uploadBytes: vi.fn(),
  normaliseImage: vi.fn(),
}));

const start = vi.mocked(startMediaUploadAction);
const complete = vi.mocked(completeMediaUploadAction);
const transfer = vi.mocked(uploadBytes);
const prepare = vi.mocked(normaliseImage);

const AVATAR_MAX_BYTES = 8 * 1024 * 1024;

function photo(name = 'photo.jpg', type = 'image/jpeg', size = 1024): File {
  const f = new File([new Uint8Array(4)], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

const startedOk = {
  ok: true as const,
  upload: {
    provider: 'supabase',
    assetId: '11111111-1111-4111-8111-111111111111',
    signedUrl: 'http://storage.test/put',
    token: 'tok',
    path: 'tenant/media/a/original',
    resumableThresholdBytes: 6 * 1024 * 1024,
    maxBytes: AVATAR_MAX_BYTES,
  },
};

const asset = { id: startedOk.upload.assetId } as unknown as MediaAsset;

/** A promise the test resolves by hand, so each state of the machine is observable. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let onCompleted: ReturnType<typeof vi.fn<(asset: MediaAsset) => void>>;
let errorSpy: ReturnType<typeof vi.spyOn>;

const mount = () =>
  renderHook(() => useSignedUpload({ kind: 'image', purpose: 'avatar', onCompleted }));

beforeEach(() => {
  onCompleted = vi.fn<(asset: MediaAsset) => void>();
  toast.show.mockReset();
  start.mockReset();
  complete.mockReset();
  transfer.mockReset();
  prepare.mockReset();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  errorSpy.mockRestore();
});

describe('the photo upload state machine (UI-SPEC §Upload contract)', () => {
  it('a phone photo outside the allow-list runs preparing → progress → processing → done, silently', async () => {
    const prepared = deferred<File>();
    const sent = deferred<{ ok: true }>();
    const completed = deferred<{ ok: true; asset: unknown }>();
    prepare.mockReturnValue(prepared.promise);
    start.mockResolvedValue(startedOk);
    transfer.mockReturnValue(sent.promise as never);
    complete.mockReturnValue(completed.promise as never);

    const { result } = mount();
    // A photo the picker never offered: `image/heif` is outside `accept`, so it arrives only from a
    // share sheet or a drop — exactly the case the browser re-encode exists for.
    let pick!: Promise<void>;
    await act(async () => {
      pick = result.current.pick(photo('IMG_0042.HEIC', 'image/heif', 2_000_000));
    });
    expect(result.current.state).toBe('preparing');
    expect(result.current.error).toBeNull();

    await act(async () => {
      prepared.resolve(photo('IMG_0042.jpg', 'image/jpeg', 900_000));
    });
    expect(result.current.state).toBe('progress');
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'image', purpose: 'avatar', mime: 'image/jpeg' }),
    );

    await act(async () => {
      sent.resolve({ ok: true });
    });
    expect(result.current.state).toBe('processing');

    await act(async () => {
      completed.resolve({ ok: true, asset });
      await pick;
    });
    expect(result.current.state).toBe('done');
    expect(result.current.error).toBeNull();
    expect(onCompleted).toHaveBeenCalledWith(asset);
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Foto atualizada.' });
  });

  it('a file the browser cannot re-encode surfaces the prepare copy — the ONLY error a phone photo can raise', async () => {
    prepare.mockRejectedValue(new Error('canvas encode failed'));
    const { result } = mount();

    await act(async () => {
      await result.current.pick(photo('IMG_0042.HEIC', 'image/heif', 2_000_000));
    });

    expect(result.current.error).toBe('Não foi possível preparar esta imagem. Tente outra foto.');
    expect(start).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      'media.upload_prepare_failed',
      expect.objectContaining({ error: expect.stringContaining('canvas encode failed') }),
    );
  });

  it('a disallowed type is refused at pick time and makes NO request', async () => {
    const { result } = mount();

    await act(async () => {
      await result.current.pick(photo('anim.gif', 'image/gif', 1000));
    });

    expect(result.current.error).toBe('Formato não suportado. Use JPEG, PNG ou WebP.');
    expect(start).not.toHaveBeenCalled();
    expect(transfer).not.toHaveBeenCalled();
  });

  it('a REJECTED start returns the zone to the generic message, logged to the console only', async () => {
    start.mockRejectedValue(new Error('boom'));
    const { result } = mount();

    await act(async () => {
      await result.current.pick(photo());
    });

    expect(result.current.progress).toBe(0);
    expect(result.current.error).toBe('Algo deu errado. Tente novamente.');
    expect(errorSpy).toHaveBeenCalledWith(
      'media.upload_failed',
      expect.objectContaining({ error: expect.stringContaining('boom') }),
    );
    expect(onCompleted).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
  });

  it("a confirmation refused with { media: 'too_large' } renders the limit INTERPOLATED", async () => {
    start.mockResolvedValue(startedOk);
    transfer.mockResolvedValue({ ok: true });
    complete.mockResolvedValue({ ok: false, code: 'too_large', maxBytes: AVATAR_MAX_BYTES });
    const { result } = mount();

    await act(async () => {
      await result.current.pick(photo());
    });

    expect(result.current.error).toBe('Arquivo muito grande. O limite é 8 MB.');
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it('the tenant quota refusal names the administrator, not a byte count', async () => {
    start.mockResolvedValue({ ok: false, code: 'quota_exceeded' });
    const { result } = mount();

    await act(async () => {
      await result.current.pick(photo());
    });

    // UI-D-46: the refusal no longer names "a comunidade". The string is shared with the platform
    // panel's own uploads (LogoUpload / IconOverrideUpload run as super_admin on a host with no
    // tenant), so it names no one and still points at the administrator, which is the actionable
    // half of the sentence.
    expect(result.current.error).toBe(
      'O limite de armazenamento foi atingido. Fale com o administrador.',
    );
  });

  it('a second pick while one is in flight is ignored (one upload per zone)', async () => {
    const sent = deferred<{ ok: true }>();
    start.mockResolvedValue(startedOk);
    transfer.mockReturnValue(sent.promise as never);
    complete.mockResolvedValue({ ok: true, asset } as never);
    const { result } = mount();

    let first!: Promise<void>;
    await act(async () => {
      first = result.current.pick(photo());
    });
    expect(result.current.state).toBe('progress');

    await act(async () => {
      await result.current.pick(photo('other.jpg'));
    });
    expect(start).toHaveBeenCalledTimes(1);

    await act(async () => {
      sent.resolve({ ok: true });
      await first;
    });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('cancelling aborts the transfer and returns to idle with NO message and no toast', async () => {
    start.mockResolvedValue(startedOk);
    let aborted = false;
    transfer.mockImplementation(
      (_started, _file, opts) =>
        new Promise((resolve) => {
          opts.signal?.addEventListener('abort', () => {
            aborted = true;
            resolve({ ok: false, reason: 'aborted' });
          });
        }),
    );
    const { result } = mount();

    let pick!: Promise<void>;
    await act(async () => {
      pick = result.current.pick(photo());
    });
    expect(result.current.state).toBe('progress');

    await act(async () => {
      result.current.cancel();
      await pick;
    });

    expect(aborted).toBe(true);
    expect(result.current.state).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(toast.show).not.toHaveBeenCalled();

    // And the zone accepts the next pick immediately.
    transfer.mockResolvedValue({ ok: true });
    complete.mockResolvedValue({ ok: true, asset } as never);
    await act(async () => {
      await result.current.pick(photo('second.jpg'));
    });
    expect(result.current.state).toBe('done');
  });
});
