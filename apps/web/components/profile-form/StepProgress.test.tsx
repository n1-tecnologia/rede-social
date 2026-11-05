// @vitest-environment happy-dom

import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { StepProgress, type StepProgressProps } from './StepProgress';

/**
 * 12.1-14 (UI-D-653, UI-D-660, UI-D-661) — the head of one step: the eyebrow "Etapa x de y", the decorative
 * segmented bar and the step title `h2`, against the real pt-BR catalog.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

function show(props: Partial<StepProgressProps> = {}) {
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <StepProgress
        title="Sobre a sua clínica"
        headingId="h"
        current={2}
        total={3}
        showProgress
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(() => cleanup());

describe('StepProgress', () => {
  it('renders the eyebrow text and one segment per step of the path, the done and current ones filled', () => {
    const { container } = show();
    expect(screen.getByText('Etapa 2 de 3')).toBeTruthy();
    const segments = [...container.querySelectorAll('[data-segment]')];
    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => segment.getAttribute('data-segment'))).toEqual([
      'on',
      'on',
      'off',
    ]);
    expect(segments[0]?.className).toContain('bg-brand');
    expect(segments[2]?.className).toContain('bg-bg-tertiary');
    for (const segment of segments) expect(segment.className).toContain('h-1');
  });

  it('keeps the bar decorative: aria-hidden, in a flex gap-1 row', () => {
    const { container } = show();
    const bar = container.querySelector('[data-step-bar]') as HTMLElement;
    expect(bar.getAttribute('aria-hidden')).toBe('true');
    expect(bar.className).toContain('flex gap-1');
  });

  it('the step title is an h2 that takes focus, is described by the eyebrow and wraps long words', () => {
    show();
    const heading = screen.getByRole('heading', { level: 2, name: 'Sobre a sua clínica' });
    expect(heading.tabIndex).toBe(-1);
    expect(heading.className).toContain('scroll-mt-4');
    expect(heading.className).toContain('break-words');
    const eyebrow = document.getElementById(heading.getAttribute('aria-describedby') ?? '');
    expect(eyebrow?.textContent).toBe('Etapa 2 de 3');
  });

  it('with progress hidden only the h2 renders, with nothing to describe it', () => {
    const { container } = show({ showProgress: false, total: 1, current: 1 });
    expect(screen.queryByText(/Etapa \d de/)).toBeNull();
    expect(container.querySelector('[data-step-bar]')).toBeNull();
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.getAttribute('aria-describedby')).toBeNull();
  });

  it('ten segments stay in one flex row that shrinks (the 320px bar), the meaning carried by the text', () => {
    const { container } = show({ total: 10, current: 4 });
    const segments = container.querySelectorAll('[data-segment]');
    expect(segments).toHaveLength(10);
    for (const segment of segments) {
      expect(segment.className).toContain('flex-1');
      expect(segment.className).toContain('min-w-0');
    }
    expect(screen.getByText('Etapa 4 de 10')).toBeTruthy();
  });

  it('renders a hostile step title as text, never as HTML (T-12.1-12)', () => {
    const hostile = '<img src=x onerror=alert(1)><b>negrito</b>';
    const { container } = show({ title: hostile });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('h2')?.textContent).toBe(hostile);
  });
});
