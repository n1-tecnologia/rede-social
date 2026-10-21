// @vitest-environment happy-dom

import type { AdminMember } from '@rede-social/contracts/moderation';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminMemberRow, MemberPills } from './AdminMemberRow';

/**
 * 09.1-16 (UI-D-523, D-498, D-500) — the "Assinatura pendente" pill on the Membros row and in the
 * sheet's identity block, with the REAL pt-BR catalog through next-intl's own translator. The pill is
 * the warning tone with its word (UI-D-520), sits after the role and status pills and before
 * "E-mail não confirmado", and never shows beside "Bloqueado" (D-489: the block wins).
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

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

const BASE: AdminMember = {
  membershipId: '6f1e3c2a-0b4d-4c8e-9a7f-1d2e3f4a5b6c',
  displayName: 'Bia Souza',
  email: 'bia@exemplo.com.br',
  avatarAssetId: null,
  role: 'member',
  status: 'active',
  isViewer: false,
};

afterEach(cleanup);

/** The pill labels in DOM order. */
function pills(): string[] {
  const line = document.querySelector('[data-member-pills]');
  return line ? Array.from(line.children).map((node) => node.textContent ?? '') : [];
}

describe('MemberPills — Assinatura pendente (UI-D-523)', () => {
  it('shows the warning pill for a cut active member', () => {
    render(<MemberPills member={{ ...BASE, subscriptionPending: true }} />);
    expect(pills()).toEqual(['Assinatura pendente']);
    expect(screen.getByText('Assinatura pendente').className).toContain('warning');
  });

  it('puts it after the role pill and before "E-mail não confirmado"', () => {
    render(
      <MemberPills
        member={{
          ...BASE,
          role: 'support_tenant',
          emailUnconfirmed: true,
          subscriptionPending: true,
        }}
      />,
    );
    expect(pills()).toEqual(['Suporte', 'Assinatura pendente', 'E-mail não confirmado']);
  });

  it('puts it after "Você" and the role of the viewer too', () => {
    render(
      <MemberPills
        member={{ ...BASE, isViewer: true, role: 'admin_tenant', subscriptionPending: true }}
      />,
    );
    expect(pills()).toEqual(['Você', 'Administrador', 'Assinatura pendente']);
  });

  it('a blocked member shows only "Bloqueado", even if the flag were present (D-489)', () => {
    render(<MemberPills member={{ ...BASE, status: 'blocked', subscriptionPending: true }} />);
    expect(pills()).toEqual(['Bloqueado']);
  });

  it('renders exactly today pills without the flag, and nothing for a plain member', () => {
    render(<MemberPills member={{ ...BASE, role: 'admin_tenant', emailUnconfirmed: true }} />);
    expect(pills()).toEqual(['Administrador', 'E-mail não confirmado']);
    cleanup();
    const { container } = render(<MemberPills member={BASE} />);
    expect(container.querySelector('[data-member-pills]')).toBeNull();
  });

  it('ignores a flag that is not strictly true', () => {
    render(<MemberPills member={{ ...BASE, subscriptionPending: false as unknown as true }} />);
    expect(document.querySelector('[data-member-pills]')).toBeNull();
  });

  it('wraps the pills on their own line under the name (E10 partial)', () => {
    render(
      <MemberPills
        member={{
          ...BASE,
          role: 'support_tenant',
          emailUnconfirmed: true,
          subscriptionPending: true,
        }}
      />,
    );
    const line = document.querySelector('[data-member-pills]');
    expect(line?.className).toContain('flex-wrap');
    expect(line?.className).toContain('gap-1');
  });
});

describe('AdminMemberRow — Assinatura pendente (E10 populated, long text)', () => {
  it('shows the pill inside the row and keeps the long name truncating', () => {
    const longName = 'Beatriz Maria da Conceição de Albuquerque Souza Pereira Machado';
    render(
      <AdminMemberRow
        member={{ ...BASE, displayName: longName, subscriptionPending: true }}
        onOpen={vi.fn()}
      />,
    );
    const row = document.querySelector(`[data-member-row="${BASE.membershipId}"]`);
    expect(row?.textContent).toContain('Assinatura pendente');
    expect(document.querySelector('[data-member-name]')?.className).toContain('truncate');
    expect(document.querySelector('[data-member-email]')?.className).toContain('truncate');
  });
});
