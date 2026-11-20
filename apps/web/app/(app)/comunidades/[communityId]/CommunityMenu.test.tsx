// @vitest-environment happy-dom

import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 11-24 (D-733, AD-1, AD-8, UI-D-869, MODER-05): the community header's "Mais opções da comunidade", with the REAL
 * pt-BR catalog through next-intl's own translator and the two server actions stubbed. The rows follow the props
 * the host builds from the API's `canReport` and `canBlock` riders, never a role and never `social`.
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

MotionGlobalConfig.skipAnimations = true;

const actions = vi.hoisted(() => ({ reportContent: vi.fn(), blockMember: vi.fn() }));

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

const { CommunityMenu } = await import('./CommunityMenu');

afterEach(cleanup);
beforeEach(() => {
  actions.reportContent.mockReset().mockResolvedValue({ ok: true, code: 'ok' });
  actions.blockMember.mockReset().mockResolvedValue({ ok: true, code: 'ok', changed: true });
});

const COMMUNITY = '5d0c1c2e-7a41-4c52-9d3a-0e6f1b2c3d40';
const CREATOR = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

function mount(over: Partial<Parameters<typeof CommunityMenu>[0]> = {}, socialOn = false) {
  return render(
    <ToastProvider>
      <CommunityMenu
        communityId={COMMUNITY}
        canReport
        block={{ membershipId: CREATOR, name: 'Ana Souza' }}
        tenantName="Instituto Aurora"
        safety={{
          socialOn,
          reportAction: actions.reportContent,
          blockAction: actions.blockMember,
        }}
        {...over}
      />
    </ToastProvider>,
  );
}

async function openMenu() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções da comunidade' }));
  });
  return screen.getByRole('dialog', { name: 'Opções da comunidade' });
}
const rowNames = (sheet: HTMLElement) =>
  within(sheet)
    .getAllByRole('button')
    .map((node) => node.textContent);

describe('CommunityMenu (11-24, UI-D-869)', () => {
  it('1. the 44px control opens "Opções da comunidade" with Denunciar and "Bloquear {nome}", the block row last', async () => {
    mount();
    const trigger = screen.getByRole('button', { name: 'Mais opções da comunidade' });
    expect(trigger.className).toContain('min-h-[44px]');
    expect(trigger.className).toContain('min-w-[44px]');
    expect(trigger.hasAttribute('data-community-more')).toBe(true);
    const sheet = await openMenu();
    expect(rowNames(sheet)).toEqual(['Denunciar comunidade', 'Bloquear Ana Souza']);
  });

  it('2. Denunciar closes the sheet and opens the report sheet with the subject community, sent once', async () => {
    mount();
    const sheet = await openMenu();
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Denunciar comunidade' }));
    });
    expect(screen.queryByRole('dialog', { name: 'Opções da comunidade' })).toBeNull();
    const report = screen.getByRole('dialog', { name: 'Denunciar comunidade' });
    expect(report.querySelector('[data-report-sheet]')?.getAttribute('data-report-sheet')).toBe(
      'community',
    );
    await act(async () => {
      fireEvent.click(within(report).getByRole('radio', { name: 'Conteúdo ofensivo ou de ódio' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar denúncia' }));
    });
    expect(actions.reportContent).toHaveBeenCalledTimes(1);
    expect(actions.reportContent).toHaveBeenCalledWith({
      subjectType: 'community',
      subjectId: COMMUNITY,
      reason: 'offensive',
    });
    expect(await screen.findByText('Denúncia enviada. Obrigado por avisar.')).toBeTruthy();
  });

  it('3. "Bloquear {nome}" opens the dialog for the creator by membership id; the social flag only picks the body', async () => {
    mount({}, false);
    let sheet = await openMenu();
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Bloquear Ana Souza' }));
    });
    let dialog = screen.getByRole('dialog', { name: 'Bloquear Ana Souza?' });
    expect(dialog.textContent).not.toContain('deixam de se seguir');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Bloquear' }));
    });
    expect(actions.blockMember).toHaveBeenCalledTimes(1);
    expect(actions.blockMember).toHaveBeenCalledWith(CREATOR);
    cleanup();

    mount({}, true);
    sheet = await openMenu();
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Bloquear Ana Souza' }));
    });
    dialog = screen.getByRole('dialog', { name: 'Bloquear Ana Souza?' });
    expect(dialog.textContent).toContain('deixam de se seguir');
  });

  it('4. staff and an organization community: Denunciar only (no block target)', async () => {
    mount({ block: null });
    const sheet = await openMenu();
    expect(rowNames(sheet)).toEqual(['Denunciar comunidade']);
  });

  it('5. nothing to offer (the creator, or riders absent) draws no control at all', () => {
    mount({ canReport: false, block: null });
    expect(screen.queryByRole('button', { name: 'Mais opções da comunidade' })).toBeNull();
    expect(document.querySelector('[data-community-more]')).toBeNull();
  });

  it('6. a long creator name keeps the full accessible name of the row (the label truncates visually)', async () => {
    const name = 'Maria das Graças Albuquerque de Oliveira Santos Pereira';
    mount({ block: { membershipId: CREATOR, name } });
    const sheet = await openMenu();
    const row = within(sheet).getByRole('button', { name: `Bloquear ${name}` });
    expect(row.querySelector('span.truncate')?.textContent).toBe(`Bloquear ${name}`);
    expect(row.className).toContain('min-h-[44px]');
  });

  it('7. a failed report keeps the sheet and its choices with the alert, and a refusal never closes silently', async () => {
    actions.reportContent.mockResolvedValue({ ok: false, code: 'failed' });
    mount();
    const sheet = await openMenu();
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Denunciar comunidade' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Spam ou propaganda' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar denúncia' }));
    });
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível enviar agora.');
    expect(
      (screen.getByRole('radio', { name: 'Spam ou propaganda' }) as HTMLInputElement).checked,
    ).toBe(true);
  });
});
