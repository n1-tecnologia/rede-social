// @vitest-environment happy-dom
import { mediaAcceptFor } from '@rede-social/contracts/media';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 08.3-03 (D-409, COURSE-12; RESEARCH Pitfall 6) — the video zone's `purpose` and `ctaVariant` props.
 *
 * The lesson form (plan 09) reuses this field under the `lesson` purpose: the pick-time accept list
 * and the `start` body must both follow the prop, or the server would judge a four-hour lecture by
 * the feed's five-minute pair. The media screen and the composers pass nothing and must behave as
 * before — `post`, brand button.
 *
 * `useSignedUpload` is stubbed to CAPTURE its options (it is the hook's own suite that proves the
 * state machine); the catalog is reduced to its keys. Nothing else is mocked: the dropzone, the
 * button and their classes are the real primitives.
 */

const { captured } = vi.hoisted(() => ({
  captured: [] as Array<{ kind: string; purpose: string }>,
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/media/useSignedUpload', () => ({
  useSignedUpload: (options: { kind: string; purpose: string }) => {
    captured.push({ kind: options.kind, purpose: options.purpose });
    return {
      state: 'idle',
      progress: 0,
      error: null,
      pick: vi.fn(),
      reject: vi.fn(),
      reset: vi.fn(),
      cancel: vi.fn(),
    };
  },
}));

const { VideoUploadField } = await import('./VideoUploadField');

const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]');
const cta = () => screen.getByRole('button', { name: 'library.upload' });

afterEach(() => {
  cleanup();
  captured.length = 0;
});

describe('VideoUploadField — purpose (08.3-03)', () => {
  it('with purpose="lesson" the hook starts a lesson upload and the input accepts the lesson pair', () => {
    render(<VideoUploadField purpose="lesson" onUploaded={vi.fn()} />);
    expect(captured.at(-1)).toEqual({ kind: 'video', purpose: 'lesson' });
    expect(fileInput()?.getAttribute('accept')).toBe(mediaAcceptFor('video', 'lesson'));
    expect(fileInput()?.getAttribute('accept')).toBe('video/mp4,video/quicktime');
  });

  it('with no prop it is the feed video of before: purpose post', () => {
    render(<VideoUploadField onUploaded={vi.fn()} />);
    expect(captured.at(-1)).toEqual({ kind: 'video', purpose: 'post' });
    expect(fileInput()?.getAttribute('accept')).toBe(mediaAcceptFor('video', 'post'));
  });
});

describe('VideoUploadField — ctaVariant (08.3-03)', () => {
  it('renders the outline button classes with ctaVariant="outline"', () => {
    render(<VideoUploadField onUploaded={vi.fn()} ctaVariant="outline" />);
    expect(cta().className).toContain('border-border-secondary');
    expect(cta().className).not.toContain('bg-button');
  });

  it('defaults to the brand button, as the media screen has always rendered it', () => {
    render(<VideoUploadField onUploaded={vi.fn()} />);
    expect(cta().className).toContain('bg-button');
    expect(cta().className).not.toContain('border-border-secondary');
  });
});
