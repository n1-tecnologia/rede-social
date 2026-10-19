// @vitest-environment happy-dom
import type { OwnerAlert } from '@rede-social/module-dashboard/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertsBell } from './AlertsBell';

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace } as never),
  };
});

const { OwnerBell } = await import('./PanelHeader');

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

/**
 * 08.7-12 (D-459, D-461, UI-D-480, UI-D-489 a/d): the bell on the API's `alerts`, never a sample.
 * Each kind reads from the answer; `event_soon` opens the event's attendee list; the at-risk
 * alert's "Enviar push" stays disabled with the "Em breve" pill; no alert means no bell.
 */
describe('08.7 OwnerBell, on the overview answer’s alerts', () => {
  const EVENT = '33333333-3333-4333-8333-333333333333';
  const ALERTS: OwnerAlert[] = [
    { kind: 'support_waiting', conversations: 2, oldestHours: 26 },
    {
      kind: 'event_soon',
      eventId: EVENT,
      title: 'Encontro de outubro',
      startsAt: '2026-10-24T22:30:00Z',
      confirmed: 90,
      capacity: 100,
    },
    { kind: 'entered_at_risk', members: 3, withPush: 1 },
  ];

  async function renderOwnerBell(alerts: readonly OwnerAlert[]) {
    const element = await OwnerBell({ alerts, timeZone: 'America/Sao_Paulo' });
    return render(<>{element}</>);
  }

  it('renders the three alert kinds from the answer, one of them urgent', async () => {
    await renderOwnerBell(ALERTS);
    const bell = screen.getByRole('button', { name: 'Alertas, 3, 1 urgente' });
    fireEvent.click(bell);
    expect(screen.getByText('2 conversas aguardando resposta')).toBeTruthy();
    expect(
      screen.getByText('Na última atualização, a espera mais antiga era de 26 horas'),
    ).toBeTruthy();
    // The event's start in the tenant's zone (22:30Z is 19:30 in São Paulo).
    expect(screen.getByText('24/10, 19h30')).toBeTruthy();
    expect(screen.getByText('Encontro de outubro: 90 de 100 vagas')).toBeTruthy();
    expect(screen.getByText('10 vagas restantes')).toBeTruthy();
    expect(screen.getByText('3 membros entraram em risco nesta semana')).toBeTruthy();
    expect(screen.getByText('1 com push')).toBeTruthy();
  });

  it('opens the attendee list from event_soon (D-461)', async () => {
    const { container } = await renderOwnerBell(ALERTS);
    const link = container.querySelector(`a[href="/eventos/${EVENT}/participantes"]`);
    expect(link?.textContent).toContain('Encontro de outubro');
  });

  it('keeps "Enviar push" disabled with the Em breve pill on the at-risk alert (UI-D-478)', async () => {
    await renderOwnerBell(ALERTS);
    const push = screen.getByRole('button', { name: 'Enviar push' }) as HTMLButtonElement;
    expect(push.disabled).toBe(true);
    expect(push.closest('[data-disabled-action]')?.textContent).toContain('Em breve');
  });

  it('with notifications off the at-risk alert has no push line and no push action (UI-D-489 d)', async () => {
    await renderOwnerBell([{ kind: 'entered_at_risk', members: 1 }]);
    expect(screen.getByRole('button', { name: 'Alertas, 1' })).toBeTruthy();
    expect(screen.getByText('1 membro entrou em risco nesta semana')).toBeTruthy();
    expect(screen.queryByText(/com push/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enviar push' })).toBeNull();
  });

  it('is absent with no alert', async () => {
    expect(await OwnerBell({ alerts: [], timeZone: 'America/Sao_Paulo' })).toBeNull();
  });
});
