// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * quick 260929-g0s — the Admins tab tells the super_admin where the first-admin invite stands.
 *
 * The catalog is the REAL `platform.json` (the ReactivateCommunity.test.tsx pattern), so a copy drift
 * fails here. Stubbed: the toast and the server action. Real: `AdminsCard`, `ResendInviteButton`.
 *
 * Claims:
 *  1. `deriveInviteState` maps the contract's four statuses + "has a verified primary host" onto the
 *     six view states, the send/resend action and whether the button is enabled.
 *  2. Each view state renders its catalog pill (the sent one with the formatted date/time).
 *  3. The button reads "Enviar convite" before any send and "Reenviar convite" after; without a
 *     verified host it is disabled with the helper line; a click calls the action once and toasts the
 *     matching success copy; a documented refusal toasts its reason.
 */

const { platform, toast } = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return {
    platform: read('platform').platform as {
      admins: Record<string, string>;
      new: Record<string, string>;
    },
    toast: { show: vi.fn(), dismiss: vi.fn() },
  };
});

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

const { AdminsCard, deriveInviteState } = await import('./AdminsCard');
const { ResendInviteButton } = await import('./ResendInviteButton');

const a = platform.admins;
const fill = (copy: string | undefined, date: string) => (copy ?? '').replace('{date}', date);

const cardLabels = (dates: { sent?: string; accepted?: string } = {}) => ({
  inviteTitle: a.inviteTitle ?? '',
  noInvite: a.noInvite ?? '',
  inviteAwaitingDomain: a.inviteAwaitingDomain ?? '',
  inviteUnsent: a.inviteUnsent ?? '',
  inviteSent: fill(a.inviteSent, dates.sent ?? ''),
  inviteAccepted: fill(a.inviteAccepted, dates.accepted ?? ''),
  inviteExpired: a.inviteExpired ?? '',
  inviteRefused: a.inviteRefused ?? '',
  adminsTitle: a.adminsTitle ?? '',
  role: a.role ?? '',
  empty: a.empty ?? '',
});

const buttonLabels = (action: 'send' | 'resend') => ({
  resend: (action === 'send' ? a.send : a.resend) ?? '',
  resendPending: (action === 'send' ? a.sendPending : a.resendPending) ?? '',
  resendHelper: a.resendHelper ?? '',
  resent: (action === 'send' ? a.sent : a.resent) ?? '',
  resendFailed: (action === 'send' ? a.sendFailed : a.resendFailed) ?? '',
  reasons: {
    email_in_use: a.resendEmailInUse ?? '',
    user_in_other_tenant: a.resendUserInOtherTenant ?? '',
  },
});

beforeEach(() => {
  toast.show.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('the catalog carries the new copy', () => {
  it('names the awaiting-domain and unsent states, the send labels and the creation hint', () => {
    expect(a.inviteAwaitingDomain).toBe('Aguardando domínio verificado');
    expect(a.inviteUnsent).toBe('Convite ainda não enviado');
    expect(a.inviteSent).toBe('Enviado em {date}');
    expect(a.invitePending).toBeUndefined();
    expect(a.send).toBe('Enviar convite');
    expect(a.sent).toBe('Convite enviado.');
    expect(platform.new.adminEmailHelper).toBe(
      'O convite será enviado para este e-mail assim que o domínio da comunidade for verificado.',
    );
  });
});

describe('deriveInviteState', () => {
  it('pending without a verified host waits for the domain; with one it can be sent now', () => {
    expect(deriveInviteState({ status: 'pending', sentAt: null }, false)).toEqual({
      status: 'awaiting_domain',
      action: 'send',
      canSend: false,
    });
    expect(deriveInviteState({ status: 'pending', sentAt: null }, true)).toEqual({
      status: 'unsent',
      action: 'send',
      canSend: true,
    });
  });

  it('a sent invite offers the resend, disabled without a verified host', () => {
    expect(deriveInviteState({ status: 'sent', sentAt: '2026-09-29T14:18:08Z' }, true)).toEqual({
      status: 'sent',
      action: 'resend',
      canSend: true,
    });
    expect(deriveInviteState({ status: 'sent', sentAt: '2026-09-29T14:18:08Z' }, false)).toEqual({
      status: 'sent',
      action: 'resend',
      canSend: false,
    });
  });

  it('an accepted invite has no action', () => {
    expect(deriveInviteState({ status: 'accepted', sentAt: '2026-09-29T14:18:08Z' }, true)).toEqual(
      { status: 'accepted', action: null, canSend: false },
    );
  });

  it('expired without sentAt is the refused state (never mailed: send); with sentAt it lapsed (resend)', () => {
    expect(deriveInviteState({ status: 'expired', sentAt: null }, true)).toEqual({
      status: 'refused',
      action: 'send',
      canSend: true,
    });
    expect(deriveInviteState({ status: 'expired', sentAt: '2026-09-20T10:00:00Z' }, true)).toEqual({
      status: 'expired',
      action: 'resend',
      canSend: true,
    });
  });
});

describe('AdminsCard pills', () => {
  const invite = (status: 'awaiting_domain' | 'unsent' | 'sent' | 'accepted') => ({
    email: 'admin@cliente.com.br',
    status,
    sentAtLabel: status === 'sent' ? '29/09/2026 14:18' : null,
    acceptedAtLabel: status === 'accepted' ? '29/09/2026' : null,
  });

  it.each([
    ['awaiting_domain', 'Aguardando domínio verificado'],
    ['unsent', 'Convite ainda não enviado'],
    ['sent', 'Enviado em 29/09/2026 14:18'],
    ['accepted', 'Aceito em 29/09/2026'],
  ] as const)('%s renders "%s"', (status, text) => {
    render(
      <AdminsCard
        invite={invite(status)}
        admins={[]}
        labels={cardLabels({ sent: '29/09/2026 14:18', accepted: '29/09/2026' })}
      />,
    );
    expect(screen.getByText(text)).toBeTruthy();
  });
});

describe('ResendInviteButton — send vs resend', () => {
  it('without a verified host: a disabled "Enviar convite" and the helper line', () => {
    const action = vi.fn();
    render(
      <ResendInviteButton
        tenantId="t-1"
        inviteId="i-1"
        canResend={false}
        labels={buttonLabels('send')}
        action={action}
      />,
    );
    const button = screen.getByRole('button', { name: 'Enviar convite' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('Adicione e verifique um domínio para enviar o convite.')).toBeTruthy();
  });

  it('after a send: an enabled "Reenviar convite" without the helper', () => {
    render(
      <ResendInviteButton
        tenantId="t-1"
        inviteId="i-1"
        canResend
        labels={buttonLabels('resend')}
        action={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: 'Reenviar convite' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(screen.queryByText('Adicione e verifique um domínio para enviar o convite.')).toBeNull();
  });

  it.each([
    ['send', 'Enviar convite', 'Convite enviado.'],
    ['resend', 'Reenviar convite', 'Convite reenviado.'],
  ] as const)(
    '%s: one click calls the action once and toasts "%s" success',
    async (kind, name, message) => {
      const action = vi.fn().mockResolvedValue({ ok: true });
      render(
        <ResendInviteButton
          tenantId="t-1"
          inviteId="i-1"
          canResend
          labels={buttonLabels(kind)}
          action={action}
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name }));
      });
      await waitFor(() => expect(toast.show).toHaveBeenCalledTimes(1));
      expect(action).toHaveBeenCalledTimes(1);
      expect(action).toHaveBeenCalledWith('t-1', 'i-1');
      expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message });
    },
  );

  it('a documented refusal toasts its reason copy', async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, reason: 'email_in_use' });
    render(
      <ResendInviteButton
        tenantId="t-1"
        inviteId="i-1"
        canResend
        labels={buttonLabels('send')}
        action={action}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' }));
    });
    await waitFor(() => expect(toast.show).toHaveBeenCalledTimes(1));
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Este e-mail já possui uma conta na plataforma e não pode receber o convite.',
    });
  });
});
