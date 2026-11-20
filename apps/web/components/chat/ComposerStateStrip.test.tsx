// @vitest-environment happy-dom

import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { type ComposerStripView, composerStateView } from '@/lib/chat-view';
import { ComposerStateStrip } from './ComposerStateStrip';

/**
 * 11-22 Task 2 (CHAT-07, D-722, D-723, UI-D-865; T-11-03): the three strips as the finished views draw them. The
 * claim that matters most: the blocked member's strip is ONE sentence, and nothing it renders (text, accessible
 * name, any attribute or class) holds a name or a block word.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
const t = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'chat',
}) as unknown as Parameters<typeof composerStateView>[2];

const strip = (
  composer: 'closed' | 'blocker' | 'removed',
  displayName: string | null = 'Carla Nunes',
): ComposerStripView => {
  const view = composerStateView(composer, { removed: composer === 'removed', displayName }, t);
  if (!view.strip) throw new Error('no strip');
  return view.strip;
};

afterEach(cleanup);

describe('the closed strip (the blocked member, UI-D-865 state 2)', () => {
  it('is one polite status with the one sentence, the lock glyph and no button', () => {
    const { container } = render(<ComposerStateStrip strip={strip('closed')} />);
    const status = screen.getByRole('status', {
      name: 'Esta conversa não aceita novas mensagens.',
    });
    expect(status.textContent).toBe('Esta conversa não aceita novas mensagens.');
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });

  it('its whole output (text, name, every attribute, every class) holds no person and no block word', () => {
    const { container } = render(<ComposerStateStrip strip={strip('closed', 'Carla Nunes')} />);
    const html = container.innerHTML.toLowerCase();
    for (const word of ['carla', 'nunes', 'bloque', 'block', 'denunc', 'report', 'desbloq']) {
      expect(html).not.toContain(word);
    }
  });
});

describe('the blocker strip (UI-D-865 state 3)', () => {
  it('names the person, offers Desbloquear and calls the handler once on one tap, with no confirmation', () => {
    const onUnblock = vi.fn();
    render(<ComposerStateStrip strip={strip('blocker')} onUnblock={onUnblock} />);
    expect(screen.getByRole('status', { name: 'Você bloqueou Carla Nunes' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear' }));
    expect(onUnblock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('while pending the button reads Desbloqueando… and cannot be tapped twice', () => {
    const onUnblock = vi.fn();
    render(<ComposerStateStrip strip={strip('blocker')} onUnblock={onUnblock} pending />);
    const button = screen.getByRole('button', { name: 'Desbloqueando…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(onUnblock).not.toHaveBeenCalled();
  });

  it('a long name is clamped to two lines and wraps, and the button is full width on its own line below 360px', () => {
    const longName = 'Maria Eduarda de Albuquerque Cavalcanti e Souza '.repeat(3).trim();
    const { container } = render(<ComposerStateStrip strip={strip('blocker', longName)} />);
    const text = container.querySelector('p');
    expect(text?.textContent).toBe(`Você bloqueou ${longName}`);
    expect(text?.className).toContain('line-clamp-2');
    expect(text?.className).toContain('break-words');
    expect(text?.className).toContain('min-w-0');
    const button = screen.getByRole('button', { name: 'Desbloquear' });
    expect(button.className).toContain('w-full');
    expect(button.className).toContain('min-[360px]:w-auto');
    expect(container.firstElementChild?.className).toContain('flex-wrap');
  });

  it('a name with markup is text, never markup', () => {
    const { container } = render(
      <ComposerStateStrip strip={strip('blocker', '<img src=x onerror=alert(1)>')} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('the removed strip (UI-D-865 state 4)', () => {
  it('reads the read-only sentence with the lock glyph and no button', () => {
    render(<ComposerStateStrip strip={strip('removed', null)} />);
    expect(
      screen.getByRole('status', {
        name: 'Este membro não está mais na comunidade. A conversa fica só para leitura.',
      }),
    ).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
