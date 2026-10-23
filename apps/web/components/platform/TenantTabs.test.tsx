// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.2-19 (UI-D-536, E12) - the tenant page's tab row. Six tabs in a FIXED order, Banco between
 * Admins and Status, each a link to its sub-route, the active one taken from the path, and the roving
 * keyboard of the shipped `Tabs` navigating to the next sub-route. The six labels scroll sideways
 * inside the shipped `Tabs` (`overflow-x-auto`), so the row never widens the page.
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

const nav = vi.hoisted(() => ({ pathname: '/plataforma/tenants/t1/banco', push: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
}));

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({
        locale: 'pt-BR',
        messages: harness.messages,
        namespace,
        onError: (error) => {
          throw error;
        },
      }),
  };
});

const { TenantTabs } = await import('./TenantTabs');

beforeEach(() => {
  nav.pathname = '/plataforma/tenants/t1/banco';
  nav.push.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const tabs = () => screen.getAllByRole('tab');

describe('TenantTabs', () => {
  it('renders Marca · Módulos · Domínios · Admins · Banco · Status in that order', () => {
    render(<TenantTabs tenantId="t1" />);
    expect(tabs().map((tab) => tab.textContent)).toEqual([
      'Marca',
      'Módulos',
      'Domínios',
      'Admins',
      'Banco',
      'Status',
    ]);
  });

  it('links each tab to its sub-route, Banco to /banco', () => {
    render(<TenantTabs tenantId="t1" />);
    expect(tabs().map((tab) => tab.getAttribute('href'))).toEqual([
      '/plataforma/tenants/t1/marca',
      '/plataforma/tenants/t1/modulos',
      '/plataforma/tenants/t1/dominios',
      '/plataforma/tenants/t1/admins',
      '/plataforma/tenants/t1/banco',
      '/plataforma/tenants/t1/status',
    ]);
  });

  it('marks Banco as the active tab on /banco and no other', () => {
    render(<TenantTabs tenantId="t1" />);
    const selected = tabs().filter((tab) => tab.getAttribute('aria-selected') === 'true');
    expect(selected.map((tab) => tab.textContent)).toEqual(['Banco']);
    expect(selected[0]?.getAttribute('tabindex')).toBe('0');
  });

  it('still marks the other tabs from their own path, and Marca for the tenant root', () => {
    nav.pathname = '/plataforma/tenants/t1/status';
    const view = render(<TenantTabs tenantId="t1" />);
    expect(
      tabs()
        .filter((tab) => tab.getAttribute('aria-selected') === 'true')
        .map((tab) => tab.textContent),
    ).toEqual(['Status']);
    view.unmount();
    nav.pathname = '/plataforma/tenants/t1';
    render(<TenantTabs tenantId="t1" />);
    expect(
      tabs()
        .filter((tab) => tab.getAttribute('aria-selected') === 'true')
        .map((tab) => tab.textContent),
    ).toEqual(['Marca']);
  });

  it('moves with the arrow keys through the six tabs and navigates to the sub-route', () => {
    render(<TenantTabs tenantId="t1" />);
    const banco = screen.getByRole('tab', { name: 'Banco' });
    fireEvent.keyDown(banco, { key: 'ArrowRight' });
    expect(nav.push).toHaveBeenLastCalledWith('/plataforma/tenants/t1/status');
    fireEvent.keyDown(banco, { key: 'ArrowLeft' });
    expect(nav.push).toHaveBeenLastCalledWith('/plataforma/tenants/t1/admins');
    fireEvent.keyDown(banco, { key: 'End' });
    expect(nav.push).toHaveBeenLastCalledWith('/plataforma/tenants/t1/status');
    fireEvent.keyDown(banco, { key: 'Home' });
    expect(nav.push).toHaveBeenLastCalledWith('/plataforma/tenants/t1/marca');
  });

  it('wraps from Status to Marca (E12: the row is a loop of six)', () => {
    nav.pathname = '/plataforma/tenants/t1/status';
    render(<TenantTabs tenantId="t1" />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Status' }), { key: 'ArrowRight' });
    expect(nav.push).toHaveBeenLastCalledWith('/plataforma/tenants/t1/marca');
  });

  it('scrolls sideways inside the tablist instead of widening the page, and centres the active tab', () => {
    render(<TenantTabs tenantId="t1" />);
    const list = screen.getByRole('tablist');
    expect(list.className).toContain('overflow-x-auto');
    expect(list.getAttribute('aria-label')).toBe('Seções do tenant');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      inline: 'center',
      block: 'nearest',
    });
    for (const tab of tabs()) expect(tab.className).toContain('whitespace-nowrap');
  });
});
