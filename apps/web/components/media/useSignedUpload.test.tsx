// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09-09 (UI-D-504 h, D-474): the member variant's pick-time cap. `maxBytes` narrows the shared table
 * for ONE hook instance; unset the hook behaves exactly as before. The API's answer stays the
 * authority, so a `too_large` envelope from a stale tab maps to the same sentence.
 *
 * Stubbed at the seams: the two server actions, the browser transfer and the toast. The translator
 * returns the key (plus the interpolated `limit`) so the assertions read the intent, not the copy.
 */

const { start, complete, normalise, send } = vi.hoisted(() => ({
  start: vi.fn(),
  complete: vi.fn(),
  normalise: vi.fn(),
  send: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values?.limit ? `${key}:${String(values.limit)}` : key,
}));
vi.mock('@rede-social/ui', () => ({ useToast: () => ({ show: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('@/app/(app)/perfil/actions', () => ({
  startMediaUploadAction: start,
  completeMediaUploadAction: complete,
}));
vi.mock('@/lib/upload', () => ({ normaliseImage: normalise, uploadBytes: send }));

const { useSignedUpload } = await import('./useSignedUpload');

const MIB = 1024 * 1024;
const photo = (bytes: number, type = 'image/jpeg') =>
  new File([new Uint8Array(bytes)], 'foto.jpg', { type });
const video = (bytes: number) =>
  new File([new Uint8Array(bytes)], 'video.mp4', { type: 'video/mp4' });
const tooLarge = (size: string) => `memberPhotoSize:${size}`;

beforeEach(() => {
  vi.clearAllMocks();
  start.mockResolvedValue({ ok: false, code: 'generic' });
});
afterEach(cleanup);

describe('useSignedUpload - the member cap (09-09)', () => {
  it('H1: a photo over the cap is refused at pick time with the member sentence and no request', async () => {
    const { result } = renderHook(() =>
      useSignedUpload({
        kind: 'image',
        purpose: 'post',
        maxBytes: 1 * MIB,
        tooLargeMessage: tooLarge,
        onCompleted: vi.fn(),
      }),
    );
    await act(async () => {
      await result.current.pick(photo(2 * MIB));
    });

    expect(result.current.error).toBe('memberPhotoSize:1 MB');
    expect(result.current.state).toBe('error');
    expect(start).not.toHaveBeenCalled();
    expect(normalise).not.toHaveBeenCalled();
  });

  it('H2: a photo at or under the cap goes on to the broker', async () => {
    const { result } = renderHook(() =>
      useSignedUpload({
        kind: 'image',
        purpose: 'post',
        maxBytes: 1 * MIB,
        tooLargeMessage: tooLarge,
        onCompleted: vi.fn(),
      }),
    );
    await act(async () => {
      await result.current.pick(photo(1 * MIB));
    });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('H3: without the option the same 2 MB photo is not refused (unchanged for the administrator)', async () => {
    const { result } = renderHook(() =>
      useSignedUpload({ kind: 'image', purpose: 'post', onCompleted: vi.fn() }),
    );
    await act(async () => {
      await result.current.pick(photo(2 * MIB));
    });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('H4: a stale tab - the broker answers too_large with its cap - gets the same member sentence', async () => {
    start.mockResolvedValue({ ok: false, code: 'too_large', maxBytes: 1 * MIB });
    const { result } = renderHook(() =>
      useSignedUpload({
        kind: 'image',
        purpose: 'post',
        // The tab believes the cap is 3 MB, so the pick-time gate lets a 2 MB photo through.
        maxBytes: 3 * MIB,
        tooLargeMessage: tooLarge,
        onCompleted: vi.fn(),
      }),
    );
    await act(async () => {
      await result.current.pick(photo(2 * MIB));
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe('memberPhotoSize:1 MB');
  });

  it('H5: a video over the member cap is refused with the shared size sentence at the member number', async () => {
    const { result } = renderHook(() =>
      useSignedUpload({
        kind: 'video',
        purpose: 'post',
        maxBytes: 20 * MIB,
        onCompleted: vi.fn(),
      }),
    );
    await act(async () => {
      await result.current.pick(video(30 * MIB));
    });
    expect(result.current.error).toBe('errors.size:20 MB');
    expect(start).not.toHaveBeenCalled();
  });

  it('H6: a re-encoded phone photo that is still over the cap is refused after the re-encode', async () => {
    normalise.mockResolvedValue(photo(2 * MIB));
    const { result } = renderHook(() =>
      useSignedUpload({
        kind: 'image',
        purpose: 'post',
        maxBytes: 1 * MIB,
        tooLargeMessage: tooLarge,
        onCompleted: vi.fn(),
      }),
    );
    await act(async () => {
      await result.current.pick(photo(3 * MIB, 'image/heic'));
    });
    expect(normalise).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe('memberPhotoSize:1 MB');
    expect(start).not.toHaveBeenCalled();
  });
});

/**
 * Quick 261118-glh: the pick-time gate routes a 'size' verdict BY KIND. Only an image may enter the
 * photo re-encode (scaling to 2048 px is what rescues a photo); a video or a file over its cap is
 * refused with the shared too-large sentence at the table cap. The old routing fed a 7 GB video to
 * the <img> decoder and the person read the photo-prepare sentence.
 *
 * A multi-GiB buffer cannot be allocated, so the file is a one-byte File whose `size` is overridden:
 * `classifyMediaFile` and `pick` read only `type` and `size`. Every expected sentence is computed from
 * the table so the cases survive the later revert of the TEMPORARY post cap.
 */
const { formatMediaLimit } = await import('./useSignedUpload');
const { MEDIA_LIMITS } = await import('@rede-social/contracts/media');

const sizedFile = (bytes: number, name: string, type: string): File => {
  const file = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
};
const capOf = (kind: 'video' | 'file', purpose: string): number => {
  const pair = (MEDIA_LIMITS[kind] as Record<string, { maxBytes: number } | undefined>)[purpose];
  if (!pair) throw new Error(`no ${kind}/${purpose} pair`);
  return pair.maxBytes;
};

describe('useSignedUpload - the pick-time gate by kind (quick 261118-glh)', () => {
  it('G1: a post video over the cap is refused with the too-large sentence, no request, no re-encode, no console error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cap = capOf('video', 'post');
    const { result } = renderHook(() =>
      useSignedUpload({ kind: 'video', purpose: 'post', onCompleted: vi.fn() }),
    );
    await act(async () => {
      await result.current.pick(sizedFile(cap + 1, 'video.mp4', 'video/mp4'));
    });

    expect(result.current.error).toBe(`errors.size:${formatMediaLimit(cap)}`);
    expect(result.current.state).toBe('error');
    expect(start).not.toHaveBeenCalled();
    expect(normalise).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('G2: a lesson video over its cap is refused the same way', async () => {
    const cap = capOf('video', 'lesson');
    const { result } = renderHook(() =>
      useSignedUpload({ kind: 'video', purpose: 'lesson', onCompleted: vi.fn() }),
    );
    await act(async () => {
      await result.current.pick(sizedFile(cap + 1, 'aula.mp4', 'video/mp4'));
    });

    expect(result.current.error).toBe(`errors.size:${formatMediaLimit(cap)}`);
    expect(start).not.toHaveBeenCalled();
    expect(normalise).not.toHaveBeenCalled();
  });

  it('G3: a PDF attachment over 50 MiB is refused the same way', async () => {
    const cap = capOf('file', 'attachment');
    const { result } = renderHook(() =>
      useSignedUpload({ kind: 'file', purpose: 'attachment', onCompleted: vi.fn() }),
    );
    await act(async () => {
      await result.current.pick(sizedFile(cap + 1, 'doc.pdf', 'application/pdf'));
    });

    expect(result.current.error).toBe(`errors.size:${formatMediaLimit(cap)}`);
    expect(start).not.toHaveBeenCalled();
    expect(normalise).not.toHaveBeenCalled();
  });

  it('G4: a video EXACTLY at the cap passes the gate and reaches the broker', async () => {
    const cap = capOf('video', 'post');
    const { result } = renderHook(() =>
      useSignedUpload({ kind: 'video', purpose: 'post', onCompleted: vi.fn() }),
    );
    await act(async () => {
      await result.current.pick(sizedFile(cap, 'video.mp4', 'video/mp4'));
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(normalise).not.toHaveBeenCalled();
  });

  it('G5: an image over its cap is still re-encoded once at the cap and goes on to the broker', async () => {
    const cap = MEDIA_LIMITS.image.post?.maxBytes ?? 0;
    normalise.mockResolvedValue(photo(1 * MIB));
    const { result } = renderHook(() =>
      useSignedUpload({ kind: 'image', purpose: 'post', onCompleted: vi.fn() }),
    );
    await act(async () => {
      await result.current.pick(photo(cap + 1 * MIB));
    });

    expect(normalise).toHaveBeenCalledTimes(1);
    expect(normalise.mock.calls[0]?.[1]).toEqual({ maxBytes: cap });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('G6: a HEIC photo is still re-encoded once and goes on to the broker', async () => {
    normalise.mockResolvedValue(photo(1 * MIB));
    const { result } = renderHook(() =>
      useSignedUpload({ kind: 'image', purpose: 'post', onCompleted: vi.fn() }),
    );
    await act(async () => {
      await result.current.pick(photo(3 * MIB, 'image/heic'));
    });

    expect(normalise).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });
});
