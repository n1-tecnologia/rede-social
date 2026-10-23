// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantDraft } from './TenantDraftProvider';

/**
 * The draft steps' gate (09.2-18, UI-D-534, UI-D-535). The new `need="project"` (the Resumo) sends a
 * draft without a checked ref, or without the manual-access values when the pre-check asked for them,
 * back to Dados, closed; the confirmation, while open, owns navigation so what it clears on the way
 * (the access, once the API answered) never moves the page. The provider is stubbed: the claims are
 * about which route the gate picks for which draft.
 */

const harness = vi.hoisted(() => ({
  replace: vi.fn(),
  update: vi.fn(),
  value: null as unknown,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: harness.replace }) }));
vi.mock('./TenantDraftProvider', () => ({ useTenantDraft: () => harness.value }));

const { RequireDraftData } = await import('./WizardDraftGuards');

const ACCESS = { databasePassword: 'a', serviceKey: 'b', publishableKey: 'c' };
const NO_ACCESS = { databasePassword: '', serviceKey: '', publishableKey: '' };

function stage(
  draft: Partial<TenantDraft> = {},
  extra: { brandReady?: boolean; confirming?: boolean; access?: typeof ACCESS } = {},
) {
  harness.value = {
    draft: {
      createdId: null,
      dataReady: true,
      hostReady: true,
      projectRef: 'abcdefghijklmnopqrst',
      manualAccess: false,
      ...draft,
    },
    brandReady: extra.brandReady ?? true,
    restored: true,
    confirming: extra.confirming ?? false,
    access: extra.access ?? NO_ACCESS,
    update: harness.update,
  };
}

beforeEach(() => {
  harness.replace.mockReset();
  harness.update.mockReset();
});
afterEach(cleanup);

describe('RequireDraftData need="project"', () => {
  it('lets a checked ref through', () => {
    stage();
    render(<RequireDraftData need="project" />);
    expect(harness.replace).not.toHaveBeenCalled();
  });

  it('sends a draft without a ref back to Dados, closed', () => {
    stage({ projectRef: '  ' });
    render(<RequireDraftData need="project" />);
    expect(harness.replace).toHaveBeenCalledExactlyOnceWith('/plataforma/novo');
    expect(harness.update).toHaveBeenCalledWith({ dataReady: false });
  });

  it('sends a manual draft without its values back to Dados, closed (a reload, memory is gone)', () => {
    stage({ manualAccess: true });
    render(<RequireDraftData need="project" />);
    expect(harness.replace).toHaveBeenCalledExactlyOnceWith('/plataforma/novo');
    expect(harness.update).toHaveBeenCalledWith({ dataReady: false });
  });

  it('asks again when only one of the three values is missing', () => {
    stage({ manualAccess: true }, { access: { ...ACCESS, publishableKey: ' ' } });
    render(<RequireDraftData need="project" />);
    expect(harness.replace).toHaveBeenCalledExactlyOnceWith('/plataforma/novo');
  });

  it('lets a manual draft through when the three values are in memory', () => {
    stage({ manualAccess: true }, { access: ACCESS });
    render(<RequireDraftData need="project" />);
    expect(harness.replace).not.toHaveBeenCalled();
  });

  it('does not ask a platform-obtained draft for values it never needed', () => {
    stage({ manualAccess: false }, { access: NO_ACCESS });
    render(<RequireDraftData need="project" />);
    expect(harness.replace).not.toHaveBeenCalled();
  });

  it('still sends an unchecked Dados to Dados, an unchecked brand to Personalização and a host to Domínio', () => {
    stage({ dataReady: false });
    render(<RequireDraftData need="project" />);
    expect(harness.replace).toHaveBeenLastCalledWith('/plataforma/novo');
    cleanup();
    harness.replace.mockReset();

    stage({}, { brandReady: false });
    render(<RequireDraftData need="project" />);
    expect(harness.replace).toHaveBeenLastCalledWith('/plataforma/novo/marca');
    cleanup();
    harness.replace.mockReset();

    stage({ hostReady: false });
    render(<RequireDraftData need="project" />);
    expect(harness.replace).toHaveBeenLastCalledWith('/plataforma/novo/dominio');
  });

  it('waits while the confirmation is open, even when it has just cleared the access', () => {
    stage(
      { manualAccess: true, createdId: '11111111-1111-4111-8111-111111111111' },
      { confirming: true },
    );
    render(<RequireDraftData need="project" />);
    expect(harness.replace).not.toHaveBeenCalled();
    cleanup();

    stage({ manualAccess: true }, { confirming: true });
    render(<RequireDraftData need="project" />);
    expect(harness.replace).not.toHaveBeenCalled();
  });

  it('sends a draft that created its tenant on to that tenant’s invite step', () => {
    stage({ createdId: '11111111-1111-4111-8111-111111111111', manualAccess: true });
    render(<RequireDraftData need="project" />);
    expect(harness.replace).toHaveBeenCalledExactlyOnceWith(
      '/plataforma/novo/11111111-1111-4111-8111-111111111111/convite',
    );
  });

  it('keeps the older needs as they were: host does not look at the project', () => {
    stage({ projectRef: '', manualAccess: true });
    render(<RequireDraftData need="host" />);
    expect(harness.replace).not.toHaveBeenCalled();
  });
});
