// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEDIA_ID, queueRow } from './fixtures.test-helper';

/**
 * 11-25 (MODER-05, D-731, D-732, UI-D-873, T-11-09, T-11-10): a reported direct message shows ALONE. The text copy is
 * whole (no clamp, `whitespace-pre-wrap`), the recording plays only through the shipped `VoicePlayer` whose first tap
 * asks the report's media path for `voice.mediaId`, a refused link is the player's own error with retry, a retired
 * recording reads "Mensagem de voz apagada" with no player, and NOTHING in the output is a link or names a
 * conversation. REAL pt-BR catalog.
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const byNamespace = new Map<string, ReturnType<typeof actual.createTranslator>>();
  return {
    ...actual,
    useTranslations: (namespace: string) => {
      let tr = byNamespace.get(namespace);
      if (!tr) {
        tr = actual.createTranslator({ locale: 'pt-BR', messages, namespace });
        byNamespace.set(namespace, tr);
      }
      return tr;
    },
  };
});

const { DirectMessageReportRow } = await import('./DirectMessageReportRow');

/** What `play()` saw: the element's `src` AT the moment of the call (the gesture-synchronous order WebKit needs). */
let played: { src: string | null }[];

beforeEach(() => {
  played = [];
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    played.push({ src: this.getAttribute('src') });
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type MessageBody = Parameters<typeof DirectMessageReportRow>[0]['body'];
const bodyOf = (over: Parameters<typeof queueRow>[0]): MessageBody =>
  queueRow({ subjectType: 'direct_message', ...over }).body as MessageBody;

const src = (id: string) => `/v1/media/${id}/original`;

describe('a text message', () => {
  const COPY = `Oi, tudo bem?\n\n${'a'.repeat(250)}`;

  it('shows the WHOLE stored copy with whitespace-pre-wrap and no clamp, plus the one-line note', () => {
    const { container } = render(
      <DirectMessageReportRow body={bodyOf({ excerpt: COPY })} mediaSrc={src} />,
    );
    const text = container.querySelector('[data-report-message-text]');
    expect(text?.textContent).toBe(COPY);
    expect(text?.className).toContain('whitespace-pre-wrap');
    expect(text?.className).not.toMatch(/line-clamp/);
    expect(screen.getByText('Só esta mensagem é mostrada.')).toBeTruthy();
  });

  it('has no link, no conversation identifier and no player in its output', () => {
    const { container } = render(
      <DirectMessageReportRow body={bodyOf({ excerpt: 'Oi' })} mediaSrc={src} />,
    );
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.querySelectorAll('audio')).toHaveLength(0);
    expect(container.innerHTML).not.toMatch(/href=|conversa|conversation/i);
  });

  it('renders a message as React text, never markup', () => {
    const { container } = render(
      <DirectMessageReportRow
        body={bodyOf({ excerpt: '<img src=x onerror=alert(1)><b>oi</b>' })}
        mediaSrc={src}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)><b>oi</b>');
  });
});

describe('a voice message (D-731)', () => {
  const voiceBody = () =>
    bodyOf({ excerpt: '', voice: { mediaId: MEDIA_ID, durationSeconds: 42, gone: false } });

  it('draws the shipped player with nothing loaded: no src and preload none until the first tap', () => {
    const { container } = render(<DirectMessageReportRow body={voiceBody()} mediaSrc={src} />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    expect(audio.getAttribute('preload')).toBe('none');
    expect(audio.hasAttribute('src')).toBe(false);
    expect(screen.getByRole('group', { name: 'Mensagem de voz, 42 segundos' })).toBeTruthy();
    expect(screen.getByText('0:42')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Velocidade de reprodução: 1x/ })).toBeTruthy();
    expect(screen.getByText('Só esta mensagem é mostrada.')).toBeTruthy();
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });

  it('the first tap asks the report media path of voice.mediaId, in the same synchronous handler as play()', () => {
    const asked: string[] = [];
    const { container } = render(
      <DirectMessageReportRow
        body={voiceBody()}
        mediaSrc={(id) => {
          asked.push(id);
          return src(id);
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tocar mensagem de voz' }));
    const audio = container.querySelector('audio') as HTMLAudioElement;
    expect(audio.getAttribute('src')).toBe(src(MEDIA_ID));
    expect(played).toEqual([{ src: src(MEDIA_ID) }]);
    expect(new Set(asked)).toEqual(new Set([MEDIA_ID]));
  });

  it("a refused link (the gate answers 404) is the player's own error state with retry, and retry asks again", async () => {
    const { container } = render(<DirectMessageReportRow body={voiceBody()} mediaSrc={src} />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    // The element cannot load the refused link: a rejected play() is the player's error state.
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(function (
      this: HTMLMediaElement,
    ) {
      played.push({ src: this.getAttribute('src') });
      return Promise.reject(Object.assign(new Error('refused'), { name: 'NetworkError' }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tocar mensagem de voz' }));
    expect(await screen.findByText('Não foi possível carregar a mensagem de voz.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(played).toHaveLength(2);
    expect(audio.getAttribute('src')).toMatch(/^\/v1\/media\/.+\/original\?r=/);
  });

  it('the speed pill cycles and announces the speed in a polite region', () => {
    const { container } = render(<DirectMessageReportRow body={voiceBody()} mediaSrc={src} />);
    fireEvent.click(screen.getByRole('button', { name: /Velocidade de reprodução: 1x/ }));
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('Velocidade 1,5x.');
  });
});

describe('a voice message whose recording is gone', () => {
  it('reads "Mensagem de voz apagada" with no player at all', () => {
    const { container } = render(
      <DirectMessageReportRow
        body={bodyOf({
          excerpt: '',
          voice: { mediaId: MEDIA_ID, durationSeconds: 42, gone: true },
        })}
        mediaSrc={src}
      />,
    );
    expect(screen.getByText('Mensagem de voz apagada')).toBeTruthy();
    expect(container.querySelectorAll('audio')).toHaveLength(0);
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.innerHTML).not.toContain(MEDIA_ID);
  });
});
