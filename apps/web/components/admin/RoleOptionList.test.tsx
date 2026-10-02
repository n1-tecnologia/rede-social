// @vitest-environment happy-dom

import type { TenantRole } from '@rede-social/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoleOptionList, type RoleOptionListProps, type RoleRefusal } from './RoleOptionList';

/**
 * 08-05 — the role list of the member admin sheet (ADMIN-02, D-332, UI-D-273, UI-D-288, UI E05),
 * with the REAL pt-BR catalog through next-intl's own translator: a named radiogroup whose options
 * are radios with `aria-checked`; arrow keys move focus without changing a role; choosing another
 * role opens the role-specific confirm; cancelling keeps the selection; the confirmed request keeps
 * the group busy and inert; a refusal leaves the selection where it was with the inline alert; a
 * blocked membership's list is disabled with its helper.
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

type Catalog = {
  admin: {
    roles: { member: string; support: string; admin: string; descriptions: { admin: string } };
    members: {
      roleLabel: string;
      roleBlockedHelper: string;
      roleConfirm: {
        title: string;
        toAdmin: string;
        toSupport: string;
        toMember: string;
        confirm: string;
        cancel: string;
      };
    };
  };
  moderation: { member: { errors: { lastAdmin: string; self: string; generic: string } } };
};
const A = (messages as unknown as Catalog).admin;
const E = (messages as unknown as Catalog).moderation.member.errors;
const NAME = 'Ana Souza';

function renderList(over: Partial<RoleOptionListProps> = {}) {
  const props: RoleOptionListProps = {
    value: 'member',
    name: NAME,
    tenantName: 'Rede Demo',
    onChange: vi.fn(async (): Promise<RoleRefusal | null> => null),
    ...over,
  };
  const view = render(<RoleOptionList {...props} />);
  return { props, view };
}

const option = (label: string) => screen.getByRole('radio', { name: new RegExp(`^${label}`) });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RoleOptionList', () => {
  it('is a radiogroup named "Papel" with three radios; only the current role is checked and tabbable', () => {
    renderList({ value: 'support_tenant' });
    const group = screen.getByRole('radiogroup', { name: A.members.roleLabel });
    expect(group).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.textContent)).toEqual([
      expect.stringContaining(A.roles.member),
      expect.stringContaining(A.roles.support),
      expect.stringContaining(A.roles.admin),
    ]);
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
    // The brand check is drawn on the selected option only.
    expect(radios.map((radio) => radio.querySelector('svg') !== null)).toEqual([
      false,
      true,
      false,
    ]);
    expect(screen.getByText(A.roles.descriptions.admin)).toBeTruthy();
  });

  it('arrow keys move focus between the three options and wrap, without changing the role', () => {
    const { props } = renderList({ value: 'member' });
    const [member, support, admin] = screen.getAllByRole('radio') as HTMLElement[];
    member?.focus();
    fireEvent.keyDown(member as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(support);
    fireEvent.keyDown(support as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(admin);
    fireEvent.keyDown(admin as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(member);
    fireEvent.keyDown(member as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(admin);
    fireEvent.keyDown(admin as HTMLElement, { key: 'Home' });
    expect(document.activeElement).toBe(member);
    fireEvent.keyDown(member as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(admin);
    // Moving focus never asks the server and never opens the confirm.
    expect(props.onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(member?.getAttribute('aria-checked')).toBe('true');
  });

  it('choosing another role opens the role-specific brand confirm; the current role opens nothing', async () => {
    renderList({ value: 'member' });
    fireEvent.click(option(A.roles.member));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(option(A.roles.admin));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(A.members.roleConfirm.title.replace('{name}', NAME));
    expect(dialog.textContent).toContain(A.members.roleConfirm.toAdmin.replace('{name}', NAME));
    expect(screen.getByRole('button', { name: A.members.roleConfirm.confirm })).toBeTruthy();
  });

  it('cancelling the confirm keeps the selection and asks nothing', async () => {
    const { props } = renderList({ value: 'member' });
    fireEvent.click(option(A.roles.support));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: A.members.roleConfirm.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(props.onChange).not.toHaveBeenCalled();
    expect(option(A.roles.member).getAttribute('aria-checked')).toBe('true');
    expect(option(A.roles.support).getAttribute('aria-checked')).toBe('false');
  });

  it('after the confirm the group is busy and inert until the server answers, with no optimistic selection', async () => {
    let answer: (value: RoleRefusal | null) => void = () => {};
    const onChange = vi.fn(
      () =>
        new Promise<RoleRefusal | null>((resolve) => {
          answer = resolve;
        }),
    );
    const { view, props } = renderList({ value: 'member', onChange });
    fireEvent.click(option(A.roles.admin));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: A.members.roleConfirm.confirm }));

    const group = screen.getByRole('radiogroup', { hidden: true });
    await waitFor(() => expect(group.getAttribute('aria-busy')).toBe('true'));
    expect(group.hasAttribute('inert')).toBe(true);
    expect(onChange).toHaveBeenCalledWith('admin_tenant');
    expect(option(A.roles.member).getAttribute('aria-checked')).toBe('true');

    // The host answers with the new role: the selection follows the server.
    await act(async () => answer(null));
    view.rerender(<RoleOptionList {...props} onChange={onChange} value={'admin_tenant'} />);
    await waitFor(() => expect(group.getAttribute('aria-busy')).toBeNull());
    expect(group.hasAttribute('inert')).toBe(false);
    expect(option(A.roles.admin).getAttribute('aria-checked')).toBe('true');
  });

  it('a refusal leaves the selection where it was and shows the inline alert under the list', async () => {
    renderList({
      value: 'admin_tenant',
      onChange: vi.fn(async (): Promise<RoleRefusal | null> => 'last_admin'),
    });
    fireEvent.click(option(A.roles.member));
    await screen.findByRole('dialog');
    expect(screen.getByRole('dialog').textContent).toContain(
      A.members.roleConfirm.toMember.replace('{name}', NAME),
    );
    fireEvent.click(screen.getByRole('button', { name: A.members.roleConfirm.confirm }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(E.lastAdmin.replace('{tenant}', 'Rede Demo'));
    expect(option(A.roles.admin).getAttribute('aria-checked')).toBe('true');
    expect(option(A.roles.member).getAttribute('aria-checked')).toBe('false');
  });

  it('a thrown action reads as the generic refusal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderList({
      onChange: vi.fn(async (): Promise<RoleRefusal | null> => {
        throw new Error('network');
      }),
    });
    fireEvent.click(option(A.roles.support));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: A.members.roleConfirm.confirm }));
    expect((await screen.findByRole('alert')).textContent).toBe(E.generic);
    expect(option(A.roles.member).getAttribute('aria-checked')).toBe('true');
  });

  it('a blocked membership: the list is disabled with the helper and choosing does nothing', () => {
    const { props } = renderList({ value: 'support_tenant', disabled: true });
    const group = screen.getByRole('radiogroup', { name: A.members.roleLabel });
    expect(group.getAttribute('aria-disabled')).toBe('true');
    expect(group.className).toContain('opacity-50');
    expect(group.getAttribute('aria-describedby')).toBeTruthy();
    const helper = document.getElementById(group.getAttribute('aria-describedby') ?? '');
    expect(helper?.textContent).toBe(A.members.roleBlockedHelper);
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.getAttribute('aria-disabled')).toBe('true');
    }
    fireEvent.click(option(A.roles.admin));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(props.onChange).not.toHaveBeenCalled();
    // Still readable: the current role is announced.
    expect(option(A.roles.support).getAttribute('aria-checked')).toBe('true');
  });

  it('the option geometry keeps the check slot on the first line (items-start)', () => {
    renderList();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.className).toContain('items-start');
      expect(radio.className).toContain('min-h-11');
    }
  });

  it('every role a membership can hold renders exactly one checked option', () => {
    for (const role of ['member', 'support_tenant', 'admin_tenant'] as TenantRole[]) {
      renderList({ value: role });
      expect(
        screen
          .getAllByRole('radio')
          .filter((radio) => radio.getAttribute('aria-checked') === 'true'),
      ).toHaveLength(1);
      cleanup();
    }
  });
});
