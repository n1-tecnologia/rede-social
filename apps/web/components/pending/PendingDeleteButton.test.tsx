// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PendingDeleteButton } from './PendingDeleteButton';

/**
 * 2026-10-20 — the "Excluir" placeholder of the client's FRONT.pdf (an event, an archived
 * community), until the API can delete either. The labels are the REAL `events.delete` strings, as
 * the event form passes them, so a copy drift fails here too. The contract:
 *  1. the danger button, named by its label, with "Em breve" beside it;
 *  2. `aria-disabled` and not `disabled`: it stays focusable and is described by the hint;
 *  3. nothing happens: inside a form a click submits nothing.
 *
 * The web workspace has no jest-dom: plain DOM assertions only.
 */

const LABELS = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const catalog = JSON.parse(
    readFileSync(join(process.cwd(), 'messages', 'pt-BR', 'events.json'), 'utf8'),
  ) as { events: { delete: { action: string; soon: string; hint: string } } };
  const copy = catalog.events.delete;
  return { label: copy.action, soon: copy.soon, hint: copy.hint };
});

afterEach(cleanup);

describe('PendingDeleteButton', () => {
  it('1. names the action, marks what it would delete and says "Em breve"', () => {
    render(<PendingDeleteButton kind="event" {...LABELS} />);
    const root = document.querySelector('[data-pending-delete="event"]') as HTMLElement;
    const button = screen.getByRole('button', { name: LABELS.label });
    expect(root.contains(button)).toBe(true);
    expect(root.textContent).toContain(LABELS.soon);
    expect(button.className).toContain('text-danger');
  });

  it('2. is aria-disabled but focusable, and described by the hint', () => {
    render(<PendingDeleteButton kind="event" {...LABELS} />);
    const button = screen.getByRole('button', { name: LABELS.label }) as HTMLButtonElement;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).toBe(false);
    button.focus();
    expect(document.activeElement).toBe(button);
    const hint = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe(LABELS.hint);
    expect(hint?.className).toContain('sr-only');
  });

  it('3. does nothing: a click inside a form submits nothing', () => {
    const submit = vi.fn((event: Event) => event.preventDefault());
    render(
      <form onSubmit={(event) => submit(event.nativeEvent)}>
        <PendingDeleteButton kind="community" {...LABELS} />
      </form>,
    );
    const button = screen.getByRole('button', { name: LABELS.label });
    expect(button.getAttribute('type')).toBe('button');
    fireEvent.click(button);
    expect(submit).not.toHaveBeenCalled();
  });
});
