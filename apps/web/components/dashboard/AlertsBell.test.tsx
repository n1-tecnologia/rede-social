// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AlertsBell } from './AlertsBell';

/**
 * The header's alerts bell (quick 261011-ndw): a disclosure that opens the alert list under the
 * header and closes on Escape (focus back on the bell), on a press outside and on a second press.
 * The badge is danger-filled only when an alert is urgent, brand-filled otherwise.
 */

afterEach(cleanup);

function renderBell(urgent = true) {
  render(
    <>
      <button type="button">Fora</button>
      <AlertsBell label="Alertas, 3" closeLabel="Fechar alertas" count={3} urgent={urgent}>
        <p>Alerta de teste</p>
      </AlertsBell>
    </>,
  );
  const bell = screen.getByRole('button', { name: 'Alertas, 3' });
  const panelId = bell.getAttribute('aria-controls') ?? '';
  const panel = document.getElementById(panelId);
  if (!panel) throw new Error('aria-controls names no element');
  return { bell, panel };
}

describe('AlertsBell', () => {
  it('starts closed, with aria-controls naming a hidden panel', () => {
    const { bell, panel } = renderBell();
    expect(bell.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hasAttribute('hidden')).toBe(true);
  });

  it('opens on a click and shows the children', () => {
    const { bell, panel } = renderBell();
    fireEvent.click(bell);
    expect(bell.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hasAttribute('hidden')).toBe(false);
    expect(panel.contains(screen.getByText('Alerta de teste'))).toBe(true);
  });

  it('closes on Escape and moves focus back to the bell', () => {
    const { bell, panel } = renderBell();
    fireEvent.click(bell);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(bell.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(bell);
  });

  it('closes on a press outside, but not on a press inside the panel', () => {
    const { bell, panel } = renderBell();
    fireEvent.click(bell);
    fireEvent.pointerDown(screen.getByText('Alerta de teste'));
    expect(bell.getAttribute('aria-expanded')).toBe('true');
    fireEvent.pointerDown(document.body);
    expect(bell.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hasAttribute('hidden')).toBe(true);
  });

  it('closes on a second press of the bell', () => {
    const { bell, panel } = renderBell();
    fireEvent.click(bell);
    fireEvent.click(bell);
    expect(bell.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hasAttribute('hidden')).toBe(true);
  });

  it('fills the badge with brand when no alert is urgent', () => {
    renderBell(false);
    const badge = screen.getByText('3');
    expect(badge.classList.contains('bg-brand')).toBe(true);
    expect(badge.classList.contains('bg-danger')).toBe(false);
    expect(badge.classList.contains('text-white')).toBe(false);
  });

  it('keeps the danger fill when an alert is urgent', () => {
    renderBell(true);
    expect(screen.getByText('3').classList.contains('bg-danger')).toBe(true);
  });

  it('stops listening once closed: a later Escape does not move focus', () => {
    const { bell } = renderBell();
    fireEvent.click(bell);
    fireEvent.click(bell);
    const outside = screen.getByRole('button', { name: 'Fora' });
    outside.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(outside);
  });
  it('closes from the close button inside the panel and moves focus back to the bell', () => {
    const { bell, panel } = renderBell();
    fireEvent.click(bell);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar alertas' }));
    expect(panel.hasAttribute('hidden')).toBe(true);
    expect(bell.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(bell);
  });

  it('rings the bell only when an alert is urgent, so urgency is not colour alone', () => {
    const { bell } = renderBell(true);
    expect(bell.querySelector('svg.lucide-bell-ring')).not.toBeNull();
    cleanup();
    const plain = renderBell(false);
    expect(plain.bell.querySelector('svg.lucide-bell-ring')).toBeNull();
  });
});
