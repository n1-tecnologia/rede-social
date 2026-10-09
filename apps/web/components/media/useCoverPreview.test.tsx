// @vitest-environment happy-dom

import { CommunityCover } from '@rede-social/module-communities/ui';
import { act, cleanup, render } from '@testing-library/react';
import { Activity, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useCoverPreview } from './useCoverPreview';

/**
 * 2026-10-06 — a cover shows in the form's preview as soon as it is uploaded. `complete` answers an
 * image still `processing`, with no variant; until the worker derives them the preview showed a
 * blank box. `useCoverPreview` keeps the picked file and `CommunityCover` (like `EventCover`) shows
 * it while that asset is the form's cover. Real: the hook and the cover; stubbed: object URLs.
 */

const made: string[] = [];
const revoked: string[] = [];
const originals = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
const setStatic = (name: 'createObjectURL' | 'revokeObjectURL', value: unknown) =>
  Object.defineProperty(URL, name, { configurable: true, writable: true, value });

let api: {
  pick: (file: File) => void;
  uploaded: (assetId: string) => void;
  setCover: (assetId: string | null) => void;
} | null = null;

/** The form's slice under test: the cover id, the hook, the card-geometry preview. */
function Harness() {
  const [cover, setCover] = useState<string | null>(null);
  const preview = useCoverPreview(cover);
  api = {
    pick: preview.onPicked,
    uploaded: (assetId) => {
      preview.onUploaded(assetId);
      setCover(assetId);
    },
    setCover,
  };
  return (
    <CommunityCover
      geometry="card"
      coverAssetId={cover}
      coverVariantWidths={[]}
      coverAlt="Capa da comunidade Clube"
      previewUrl={preview.previewUrl}
    />
  );
}

const shown = () =>
  document.querySelector<HTMLImageElement>('img[data-cover-local-preview]')?.getAttribute('src');
const file = (name: string) => new File(['jpg'], name, { type: 'image/jpeg' });

beforeEach(() => {
  made.length = 0;
  revoked.length = 0;
  setStatic('createObjectURL', () => {
    const url = `blob:capa-${made.length + 1}`;
    made.push(url);
    return url;
  });
  setStatic('revokeObjectURL', (url: string) => revoked.push(url));
});

afterEach(() => {
  cleanup();
  api = null;
  setStatic('createObjectURL', originals.create);
  setStatic('revokeObjectURL', originals.revoke);
});

describe('useCoverPreview + CommunityCover', () => {
  it('shows the uploaded file at once, on the photo branch with its veil', () => {
    render(<Harness />);
    expect(document.querySelector('[data-testid="community-cover-fallback"]')).not.toBeNull();

    act(() => {
      api?.pick(file('capa.jpg'));
      api?.uploaded('0c000000-0000-4000-8000-0000000000a1');
    });
    expect(document.querySelector('[data-testid="community-cover-image"]')).not.toBeNull();
    expect(shown()).toBe('blob:capa-1');
  });

  it('a new cover replaces the picture and frees the old one; another cover shows none', () => {
    render(<Harness />);
    act(() => {
      api?.pick(file('a.jpg'));
      api?.uploaded('0c000000-0000-4000-8000-0000000000a1');
    });
    act(() => {
      api?.pick(file('b.jpg'));
      api?.uploaded('0c000000-0000-4000-8000-0000000000a2');
    });
    expect(shown()).toBe('blob:capa-2');
    expect(revoked).toContain('blob:capa-1');

    // The saved cover (or any other asset) is the served image, never the local picture.
    act(() => api?.setCover('0c000000-0000-4000-8000-0000000000ff'));
    expect(shown()).toBeUndefined();
    act(() => api?.setCover(null));
    expect(document.querySelector('[data-testid="community-cover-fallback"]')).not.toBeNull();
  });

  it('a pick whose upload never completes shows nothing and holds no object URL', () => {
    render(<Harness />);
    act(() => api?.pick(file('falhou.jpg')));
    expect(shown()).toBeUndefined();
    expect(made).toEqual([]);
  });

  it('the shown picture is freed on unmount', () => {
    render(<Harness />);
    act(() => {
      api?.pick(file('capa.jpg'));
      api?.uploaded('0c000000-0000-4000-8000-0000000000a1');
    });
    expect(shown()).toBe('blob:capa-1');
    cleanup();
    expect(revoked).toEqual(['blob:capa-1']);
  });

  it('08.2-12: an <Activity> hide and show never leaves the preview on a revoked URL', () => {
    function Host({ mode }: { mode: 'visible' | 'hidden' }) {
      return (
        <Activity mode={mode}>
          <Harness />
        </Activity>
      );
    }
    const view = render(<Host mode="visible" />);
    act(() => {
      api?.pick(file('capa.jpg'));
      api?.uploaded('0c000000-0000-4000-8000-0000000000a1');
    });
    act(() => view.rerender(<Host mode="hidden" />));
    act(() => view.rerender(<Host mode="visible" />));
    const src = shown();
    expect(src).toBeTruthy();
    expect(revoked).not.toContain(src);
  });
});
