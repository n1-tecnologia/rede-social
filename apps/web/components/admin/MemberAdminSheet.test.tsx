// @vitest-environment happy-dom

import type { AdminMember } from '@rede-social/contracts/moderation';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemberAdminSheet, type MemberAdminSheetProps } from './MemberAdminSheet';

/**
 * 08-04 — the member admin sheet's variants and its confirm step (UI-D-272..274, UI E04/E06), with
 * the REAL pt-BR catalog through next-intl's own translator. Each variant renders exactly the
 * controls UI-D-272 lists; "Voltar" keeps the typed reason; a refusal stays inline with the reason;
 * an empty or whitespace-only reason is sent as none.
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

MotionGlobalConfig.skipAnimations = true;

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

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
      createElement('a', { href, ...rest }, children as never),
  };
});

type Catalog = {
  admin: { members: Record<string, unknown> & { invitedBody: string; viewProfile: string } };
  moderation: { member: Record<string, unknown> };
};
const A = (messages as unknown as Catalog).admin.members;
const M = (messages as unknown as Catalog).moderation.member as {
  block: string;
  unblock: string;
  confirmBlock: string;
  confirmUnblock: string;
  back: string;
  blockStep: { title: string };
  unblockStep: { title: string };
  reason: { label: string };
  errors: { lastAdmin: string; self: string };
};

const BASE: AdminMember = {
  membershipId: '6f1e3c2a-0b4d-4c8e-9a7f-1d2e3f4a5b6c',
  displayName: 'Ana Souza',
  email: 'ana@exemplo.com',
  avatarAssetId: null,
  role: 'member',
  status: 'active',
  isViewer: false,
};

function renderSheet(over: Partial<MemberAdminSheetProps> = {}, member: Partial<AdminMember> = {}) {
  const props: MemberAdminSheetProps = {
    member: { ...BASE, ...member },
    open: true,
    onClose: vi.fn(),
    tenantName: 'Rede Demo',
    canModerate: true,
    onAccess: vi.fn(async () => ({
      ok: true as const,
      member: { ...BASE, status: 'blocked' as const },
    })),
    onSettled: vi.fn(),
    ...over,
  };
  render(<MemberAdminSheet {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MemberAdminSheet — variants (UI-D-272)', () => {
  it('active: identity block, danger "Bloquear acesso" and the "Ver perfil" link, nothing else', () => {
    renderSheet();
    expect(screen.getByRole('heading', { name: 'Ana Souza' })).toBeTruthy();
    expect(screen.getByText('ana@exemplo.com')).toBeTruthy();
    expect(screen.getByRole('button', { name: M.block })).toBeTruthy();
    expect(screen.queryByRole('button', { name: M.unblock })).toBeNull();
    const profile = screen.getByRole('link', { name: A.viewProfile });
    expect(profile.getAttribute('href')).toBe(`/membros/${BASE.membershipId}`);
    expect(screen.queryByText(A.invitedBody.replace('{email}', BASE.email))).toBeNull();
  });

  it('blocked: "Desbloquear acesso" and the "Bloqueado" pill, with no "Ver perfil"', () => {
    renderSheet({}, { status: 'blocked' });
    expect(screen.getByRole('button', { name: M.unblock })).toBeTruthy();
    expect(screen.queryByRole('button', { name: M.block })).toBeNull();
    expect(screen.queryByRole('link', { name: A.viewProfile })).toBeNull();
    expect(screen.getByText('Bloqueado')).toBeTruthy();
  });

  it('invited: the identity block and the invited body only — no action, no profile link', () => {
    renderSheet({}, { status: 'invited', displayName: null, role: 'admin_tenant' });
    expect(screen.getByRole('heading', { name: BASE.email })).toBeTruthy();
    expect(screen.getByText(A.invitedBody.replace('{email}', BASE.email))).toBeTruthy();
    expect(screen.queryByRole('button', { name: M.block })).toBeNull();
    expect(screen.queryByRole('button', { name: M.unblock })).toBeNull();
    expect(screen.queryByRole('link', { name: A.viewProfile })).toBeNull();
    expect(screen.getByText('Convite pendente')).toBeTruthy();
    expect(screen.getByText('Administrador')).toBeTruthy();
  });

  it('without moderation.manage: no access action (the role list joins in 08-05), the profile link stays', () => {
    renderSheet({ canModerate: false });
    expect(screen.queryByRole('button', { name: M.block })).toBeNull();
    expect(screen.getByRole('link', { name: A.viewProfile })).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('opened from the profile: no "Ver perfil"', () => {
    renderSheet({ showViewProfile: false });
    expect(screen.queryByRole('link', { name: A.viewProfile })).toBeNull();
    expect(screen.getByRole('button', { name: M.block })).toBeTruthy();
  });

  it('the e-mail wraps anywhere instead of widening the sheet', () => {
    renderSheet({}, { email: `${'x'.repeat(60)}@exemplo.com` });
    const email = document.querySelector('[data-member-sheet-email]');
    expect(email?.className).toContain('[overflow-wrap:anywhere]');
  });
});

describe('MemberAdminSheet — the confirm step (UI-D-274)', () => {
  it('"Voltar" returns to the main step and keeps the typed reason', async () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: M.block }));
    expect(
      screen.getByRole('heading', { name: M.blockStep.title.replace('{name}', 'Ana Souza') }),
    ).toBeTruthy();
    const reason = screen.getByLabelText(M.reason.label) as HTMLTextAreaElement;
    expect(reason.maxLength).toBe(500);
    fireEvent.change(reason, { target: { value: 'Spam repetido' } });

    fireEvent.click(screen.getByRole('button', { name: M.back }));
    expect(screen.getByRole('heading', { name: 'Ana Souza' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: M.block }));
    expect((screen.getByLabelText(M.reason.label) as HTMLTextAreaElement).value).toBe(
      'Spam repetido',
    );
  });

  it('the counter appears from 450 characters, not before', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: M.block }));
    const reason = screen.getByLabelText(M.reason.label);
    fireEvent.change(reason, { target: { value: 'a'.repeat(449) } });
    expect(screen.queryByText('449/500')).toBeNull();
    fireEvent.change(reason, { target: { value: 'a'.repeat(450) } });
    expect(screen.getByText('450/500')).toBeTruthy();
  });

  it('a whitespace-only reason is sent as none, and success goes back to the host', async () => {
    const props = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: M.block }));
    fireEvent.change(screen.getByLabelText(M.reason.label), { target: { value: '   ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: M.confirmBlock }));
    });
    await waitFor(() => expect(props.onSettled).toHaveBeenCalled());
    expect(props.onAccess).toHaveBeenCalledWith(BASE.membershipId, 'block', undefined);
    expect(props.onSettled).toHaveBeenCalledWith({
      kind: 'changed',
      member: { ...BASE, status: 'blocked' },
      change: 'block',
    });
  });

  it('a refusal renders inline (role=alert), keeps the step and the reason', async () => {
    const props = renderSheet({
      onAccess: vi.fn(async () => ({ ok: false as const, code: 'last_admin' as const })),
    });
    fireEvent.click(screen.getByRole('button', { name: M.block }));
    fireEvent.change(screen.getByLabelText(M.reason.label), { target: { value: '  motivo  ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: M.confirmBlock }));
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(M.errors.lastAdmin.replace('{tenant}', 'Rede Demo'));
    expect(props.onAccess).toHaveBeenCalledWith(BASE.membershipId, 'block', 'motivo');
    expect(props.onSettled).not.toHaveBeenCalled();
    expect((screen.getByLabelText(M.reason.label) as HTMLTextAreaElement).value).toBe('  motivo  ');
  });

  it('a blocked membership confirms with "Desbloquear"; gone and forbidden go back to the host', async () => {
    const props = renderSheet(
      { onAccess: vi.fn(async () => ({ ok: false as const, code: 'gone' as const })) },
      { status: 'blocked' },
    );
    fireEvent.click(screen.getByRole('button', { name: M.unblock }));
    expect(
      screen.getByRole('heading', { name: M.unblockStep.title.replace('{name}', 'Ana Souza') }),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: M.confirmUnblock }));
    });
    await waitFor(() =>
      expect(props.onSettled).toHaveBeenCalledWith({
        kind: 'gone',
        membershipId: BASE.membershipId,
      }),
    );
  });
});

/**
 * 08-05 — the role list inside the sheet (UI-D-272 (2), UI-D-273, UI E04/partial): shown only for
 * `members.manage`, above the access action; disabled on a blocked membership; absent on an invited
 * one. A success settles as `{ kind: 'role' }` and the sheet stays open; a vanished member and a lost
 * permission settle like an access change; a refusal stays inline under the list.
 */
describe('MemberAdminSheet — role list (08-05)', () => {
  const C = (
    messages as unknown as {
      admin: {
        roles: { support: string; admin: string };
        members: { roleConfirm: { confirm: string } };
      };
    }
  ).admin;
  const CONFIRM = C.members.roleConfirm.confirm;
  const radio = (label: string) => screen.getByRole('radio', { name: new RegExp(`^${label}`) });
  const okRole = () =>
    vi.fn(async () => ({
      ok: true as const,
      member: { ...BASE, role: 'support_tenant' as const },
    }));

  it('members.manage only: the role list without the access action', () => {
    renderSheet({ canModerate: false, canManageMembers: true, onRole: okRole() });
    expect(screen.getByRole('radiogroup')).toBeTruthy();
    expect(screen.queryByRole('button', { name: M.block })).toBeNull();
  });

  it('moderation.manage only: the access action without the role list', () => {
    renderSheet({ canModerate: true, canManageMembers: false, onRole: okRole() });
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByRole('button', { name: M.block })).toBeTruthy();
  });

  it('both: the role list sits above the access action', () => {
    renderSheet({ canManageMembers: true, onRole: okRole() });
    const group = screen.getByRole('radiogroup');
    const action = screen.getByRole('button', { name: M.block });
    expect(group.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('blocked: the list is disabled; invited: there is no list', () => {
    renderSheet({ canManageMembers: true, onRole: okRole() }, { status: 'blocked' });
    expect(screen.getByRole('radiogroup').getAttribute('aria-disabled')).toBe('true');
    cleanup();
    renderSheet({ canManageMembers: true, onRole: okRole() }, { status: 'invited' });
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('a confirmed change settles as role and the sheet does not close itself', async () => {
    const onRole = okRole();
    const props = renderSheet({ canManageMembers: true, onRole });
    fireEvent.click(radio(C.roles.support));
    fireEvent.click(await screen.findByRole('button', { name: CONFIRM }));
    await waitFor(() =>
      expect(props.onSettled).toHaveBeenCalledWith({
        kind: 'role',
        member: { ...BASE, role: 'support_tenant' },
      }),
    );
    expect(onRole).toHaveBeenCalledWith(BASE.membershipId, 'support_tenant');
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('a vanished member or a lost permission settles like an access change; a refusal stays inline', async () => {
    for (const code of ['gone', 'forbidden'] as const) {
      const props = renderSheet({
        canManageMembers: true,
        onRole: vi.fn(async () => ({ ok: false as const, code })),
      });
      fireEvent.click(radio(C.roles.admin));
      fireEvent.click(await screen.findByRole('button', { name: CONFIRM }));
      await waitFor(() =>
        expect(props.onSettled).toHaveBeenCalledWith(
          code === 'gone'
            ? { kind: 'gone', membershipId: BASE.membershipId }
            : { kind: 'forbidden' },
        ),
      );
      expect(screen.queryByRole('alert')).toBeNull();
      cleanup();
    }
    const props = renderSheet({
      canManageMembers: true,
      onRole: vi.fn(async () => ({ ok: false as const, code: 'not_active' as const })),
    });
    fireEvent.click(radio(C.roles.admin));
    fireEvent.click(await screen.findByRole('button', { name: CONFIRM }));
    expect((await screen.findByRole('alert')).textContent).toBeTruthy();
    expect(props.onSettled).not.toHaveBeenCalled();
  });
});
