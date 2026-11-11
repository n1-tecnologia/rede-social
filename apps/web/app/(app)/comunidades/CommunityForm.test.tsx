// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 08.2-10 — the community edit form's READ-ONLY "Acesso" block (D-363, UI-D-379, E13), against the
 * real merged pt-BR catalogs. The block lists the products that make the community exclusive as
 * links to `/loja/{id}` (archived ones suffixed), says "Aberta para todos os membros." with none,
 * and is ABSENT without its prop (store off, no permission, or a failed access read). Nothing in it
 * writes: links are edited in the product form only.
 *
 * 09.3 (the client's FRONT.pdf item 12): an ARCHIVED community's form also offers a LIVE "Excluir
 * comunidade" behind its own confirmation (D-553); an active community and the create form offer none.
 *
 * The web workspace has no jest-dom: plain DOM assertions only.
 */

MotionGlobalConfig.skipAnimations = true;

vi.mock('next-intl', async (orig) => {
  const actual = await orig<typeof import('next-intl')>();
  const { join } = await import('node:path');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => ({ show: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock('@/app/(app)/comunidades/actions', () => ({
  archiveCommunityAction: vi.fn(),
  createCommunityAction: vi.fn(),
  deleteCommunityAction: vi.fn(),
  reactivateCommunityAction: vi.fn(),
  updateCommunityAction: vi.fn(),
}));

vi.mock('@/components/media/useSignedUpload', () => ({
  useSignedUpload: () => ({
    state: 'idle',
    progress: 0,
    error: null,
    pick: vi.fn(),
    reject: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
  }),
}));

const actions = await import('@/app/(app)/comunidades/actions');
const { CommunityForm } = await import('./CommunityForm');

const COMMUNITY = '66666666-6666-4666-8666-666666666666';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

const INITIAL = {
  name: 'Bastidores da mentoria',
  description: 'Seis encontros.',
  coverAssetId: null,
  coverVariantWidths: [],
  status: 'active' as const,
};

function renderEdit(accessProducts?: Parameters<typeof CommunityForm>[0]['accessProducts']) {
  return render(
    <CommunityForm
      mode="edit"
      communityId={COMMUNITY}
      initial={INITIAL}
      tenantName="Rede Demo"
      accessProducts={accessProducts}
    />,
  );
}

afterEach(cleanup);

describe('CommunityForm — the read-only "Acesso" block (UI-D-379)', () => {
  it('1. lists the gating products as links, the archived one suffixed, with the helper', () => {
    renderEdit([
      { id: P1, name: 'Mentoria em grupo', href: `/loja/${P1}`, archived: false },
      { id: P2, name: 'Curso de oratória 2025', href: `/loja/${P2}`, archived: true },
    ]);

    const block = document.querySelector('[data-community-access]') as HTMLElement;
    expect(block).not.toBeNull();
    expect(block.textContent).toContain('Acesso');
    expect(document.querySelector('[data-community-access-value]')?.textContent).toBe(
      'Liberada pelos produtos: Mentoria em grupo e Curso de oratória 2025 (arquivado)',
    );
    const first = screen.getByRole('link', { name: 'Mentoria em grupo' });
    expect(first.getAttribute('href')).toBe(`/loja/${P1}`);
    expect(screen.getByRole('link', { name: 'Curso de oratória 2025' }).getAttribute('href')).toBe(
      `/loja/${P2}`,
    );
    expect(block.textContent).toContain('Para mudar, edite o produto na Loja.');
    // Read-only: no field and no button inside the block.
    expect(block.querySelector('input, textarea, button, select')).toBeNull();
    // After the description, before the archive row.
    const description = document.getElementById('community-description') as HTMLElement;
    expect(
      description.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('2. with no product it reads "Aberta para todos os membros."', () => {
    renderEdit([]);
    expect(document.querySelector('[data-community-access-value]')?.textContent).toBe(
      'Aberta para todos os membros.',
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('3. without the prop (store off, no permission, failed read) the block is absent', () => {
    renderEdit();
    expect(document.querySelector('[data-community-access]')).toBeNull();
    // The rest of the edit form is untouched.
    expect((document.getElementById('community-name') as HTMLInputElement).value).toBe(
      'Bastidores da mentoria',
    );
  });

  it('4. the create form never shows it', () => {
    render(<CommunityForm mode="create" tenantName="Rede Demo" accessProducts={[]} />);
    expect(document.querySelector('[data-community-access]')).toBeNull();
  });
});

describe('CommunityForm — "Excluir comunidade", live and archived-only (09.3, D-553)', () => {
  it('5. an archived community offers it beside "Reativar", and it deletes only after the confirmation', async () => {
    const actions = await import('@/app/(app)/comunidades/actions');
    vi.mocked(actions.deleteCommunityAction).mockResolvedValue({
      ok: true,
      communityId: COMMUNITY,
    });
    render(
      <CommunityForm
        mode="edit"
        communityId={COMMUNITY}
        initial={{ ...INITIAL, status: 'archived' }}
        tenantName="Rede Demo"
      />,
    );
    expect(document.querySelector('[data-community-reactivate]')).not.toBeNull();
    const control = document.querySelector('[data-delete-control="community"]') as HTMLElement;
    const button = screen.getByRole('button', { name: 'Excluir comunidade' });
    expect(control.contains(button)).toBe(true);
    expect(button.getAttribute('type')).toBe('button');
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(control.textContent).not.toContain('Em breve');

    fireEvent.click(button);
    expect(screen.getByRole('dialog').textContent).toContain('Excluir comunidade?');
    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(actions.deleteCommunityAction).toHaveBeenCalledTimes(1));
    expect(actions.deleteCommunityAction).toHaveBeenCalledWith(COMMUNITY);
    expect(actions.updateCommunityAction).not.toHaveBeenCalled();
    expect(actions.archiveCommunityAction).not.toHaveBeenCalled();
    expect(actions.reactivateCommunityAction).not.toHaveBeenCalled();
  });

  it('6. an active community has only "Arquivar comunidade", and creating has neither', () => {
    renderEdit();
    expect(document.querySelector('[data-community-archive]')).not.toBeNull();
    expect(document.querySelector('[data-delete-control]')).toBeNull();
    cleanup();

    render(<CommunityForm mode="create" tenantName="Rede Demo" />);
    expect(document.querySelector('[data-delete-control]')).toBeNull();
  });
});

describe('CommunityForm — the member variant (10-13, UI-D-707)', () => {
  const AUDIENCE = 'Todos os membros de Rede Demo veem esta comunidade. Só você publica nela.';

  it('7. member mode adds the audience line under "Descrição", with the tenant name', () => {
    render(<CommunityForm mode="create" tenantName="Rede Demo" memberMode />);
    const line = document.querySelector('[data-community-audience]') as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.textContent).toBe(AUDIENCE);
    // `Users` 14 beside a 12/400 tertiary line, after the description field.
    expect(line.className).toContain('text-text-tertiary');
    const description = document.getElementById('community-description') as HTMLElement;
    expect(
      description.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('8. the organization form carries no audience line and no member-only copy', () => {
    render(<CommunityForm mode="create" tenantName="Rede Demo" />);
    expect(document.querySelector('[data-community-audience]')).toBeNull();
    expect(document.body.textContent).not.toContain('Só você publica nela');
  });

  it('9. member mode never renders the store "Acesso" block, whatever the host passes', () => {
    render(
      <CommunityForm
        mode="edit"
        communityId={COMMUNITY}
        initial={INITIAL}
        tenantName="Rede Demo"
        memberMode
        accessProducts={[{ id: P1, name: 'Mentoria', href: `/loja/${P1}`, archived: false }]}
      />,
    );
    expect(document.querySelector('[data-community-access]')).toBeNull();
    expect(document.querySelector('[data-community-audience]')).not.toBeNull();
  });

  it('10. the member form keeps the shipped chrome: close, cover picker, name, description, submit', () => {
    render(<CommunityForm mode="create" tenantName="Rede Demo" memberMode />);
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeTruthy();
    expect(document.getElementById('community-name')).not.toBeNull();
    expect(document.getElementById('community-description')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Criar comunidade' })).toBeTruthy();
    expect(document.querySelector('[data-cover-preview-fallback]')).not.toBeNull();
  });
});

describe('CommunityForm — the limit screen and the refusals (10-13, UI-D-707, E07)', () => {
  const LIMIT_SENTENCE =
    'Você chegou ao limite de 3 comunidades ativas. Arquive uma para criar outra.';

  it('14. opened at the limit the form is NOT rendered: header, empty state and the way back', () => {
    render(
      <CommunityForm mode="create" tenantName="Rede Demo" memberMode limitReached={{ limit: 3 }} />,
    );

    expect(document.getElementById('community-name')).toBeNull();
    expect(document.querySelector('[data-community-form]')).toBeNull();
    expect(screen.getByText('Nova comunidade')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeTruthy();
    expect(screen.getByText('Limite de comunidades atingido')).toBeTruthy();
    expect(screen.getByText(LIMIT_SENTENCE)).toBeTruthy();
    const back = screen.getByRole('link', { name: 'Ver comunidades' });
    expect(back.getAttribute('href')).toBe('/comunidades');
    expect(screen.queryByRole('button', { name: 'Criar comunidade' })).toBeNull();
  });

  it('15. a limit refusal at submit keeps every value and shows the top alert', async () => {
    vi.mocked(actions.createCommunityAction).mockResolvedValue({
      ok: false,
      code: 'limit_reached',
    });
    render(<CommunityForm mode="create" tenantName="Rede Demo" memberMode />);
    fireEvent.change(document.getElementById('community-name') as HTMLInputElement, {
      target: { value: 'Horta em casa' },
    });
    fireEvent.change(document.getElementById('community-description') as HTMLTextAreaElement, {
      target: { value: 'Troca de mudas.' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Criar comunidade' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'Você já chegou ao limite de comunidades ativas. Arquive uma para criar outra.',
    );
    expect(alert.className).toContain('border-danger/40');
    expect((document.getElementById('community-name') as HTMLInputElement).value).toBe(
      'Horta em casa',
    );
    expect((document.getElementById('community-description') as HTMLTextAreaElement).value).toBe(
      'Troca de mudas.',
    );
  });

  it('16. a 403 on a member form says the Rede social was turned off, keeping the values', async () => {
    vi.mocked(actions.createCommunityAction).mockResolvedValue({ ok: false, code: 'forbidden' });
    render(<CommunityForm mode="create" tenantName="Rede Demo" memberMode />);
    fireEvent.change(document.getElementById('community-name') as HTMLInputElement, {
      target: { value: 'Horta em casa' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Criar comunidade' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'A Rede social foi desativada. Não é possível criar ou editar comunidades agora.',
    );
    expect((document.getElementById('community-name') as HTMLInputElement).value).toBe(
      'Horta em casa',
    );
  });

  it('17. the same 403 on the ORGANIZATION form keeps the shipped generic error', async () => {
    vi.mocked(actions.createCommunityAction).mockResolvedValue({ ok: false, code: 'forbidden' });
    render(<CommunityForm mode="create" tenantName="Rede Demo" />);
    fireEvent.change(document.getElementById('community-name') as HTMLInputElement, {
      target: { value: 'Avisos' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Criar comunidade' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toContain('Rede social');
  });
});

/**
 * 10-14 Task 3 (UI-D-712, UI-D-714): the archive confirmation has THREE copy variants chosen by the
 * viewer's relation to the community (`relation`, computed by the host from the API's flags): the
 * organization's shipped one, the owner's (no feed sentence: a member community's posts are in no feed)
 * and the moderator's (it states the consequence and that the creator is not told). The sentences are
 * literals here on purpose: the contract is the words.
 */
describe('CommunityForm — the archive confirmation in three variants (10-14, UI-D-712, UI-D-714)', () => {
  function openArchive(relation?: 'organization' | 'owner' | 'moderator') {
    render(
      <CommunityForm
        mode="edit"
        communityId={COMMUNITY}
        initial={INITIAL}
        tenantName="Rede Demo"
        memberMode={relation !== undefined && relation !== 'organization'}
        relation={relation}
      />,
    );
    fireEvent.click(document.querySelector('[data-community-archive]') as HTMLElement);
    return screen.getByRole('dialog');
  }

  it('19. the organization (and a form with no relation) keeps the shipped sentence about the feed', () => {
    for (const relation of [undefined, 'organization' as const]) {
      const dialog = openArchive(relation);
      expect(dialog.textContent).toContain('Arquivar comunidade?');
      expect(dialog.textContent).toContain(
        'Ela sai da lista e ninguém mais publica nela. As publicações continuam no feed.',
      );
      expect(screen.getByRole('button', { name: 'Arquivar' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
      cleanup();
    }
  });

  it('20. the owner of a member community drops the feed sentence and can reactivate whenever', () => {
    const dialog = openArchive('owner');

    expect(dialog.textContent).toContain('Arquivar comunidade?');
    expect(dialog.textContent).toContain(
      'Ela sai da lista e ninguém mais publica nela. Você pode reativar quando quiser.',
    );
    expect(dialog.textContent).not.toContain('feed');
    expect(screen.getByRole('button', { name: 'Arquivar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manter comunidade' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
  });

  it('21. the moderator reads the consequence and that the creator is not told', () => {
    const dialog = openArchive('moderator');

    expect(dialog.textContent).toContain('Arquivar comunidade?');
    expect(dialog.textContent).toContain(
      'Ela sai da lista e ninguém mais publica nela. A pessoa que criou não é avisada.',
    );
    expect(screen.getByRole('button', { name: 'Arquivar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manter comunidade' })).toBeTruthy();
  });

  it('22. the moderator edits a member community with no audience line and no store block; the owner keeps the line', () => {
    const products = [{ id: P1, name: 'Mentoria', href: `/loja/${P1}`, archived: false }];
    const edit = (relation: 'owner' | 'moderator') => (
      <CommunityForm
        mode="edit"
        communityId={COMMUNITY}
        initial={INITIAL}
        tenantName="Rede Demo"
        memberMode
        relation={relation}
        accessProducts={products}
      />
    );

    const { unmount } = render(edit('moderator'));
    expect(document.querySelector('[data-community-audience]')).toBeNull();
    expect(document.querySelector('[data-community-access]')).toBeNull();
    unmount();

    render(edit('owner'));
    expect(document.querySelector('[data-community-audience]')).not.toBeNull();
    expect(document.querySelector('[data-community-access]')).toBeNull();
  });

  it('23. on an archived community the relation reaches "Excluir comunidade": the moderator copy', () => {
    render(
      <CommunityForm
        mode="edit"
        communityId={COMMUNITY}
        initial={{ ...INITIAL, status: 'archived' }}
        tenantName="Rede Demo"
        memberMode
        relation="moderator"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Excluir comunidade' }));
    expect(screen.getByRole('dialog').textContent).toContain('A pessoa que criou não é avisada.');
    expect(screen.getByRole('button', { name: 'Manter comunidade' })).toBeTruthy();
  });

  it('24. the creator sees Reativar and Excluir on an archived community exactly as on any, with no hint of who archived it', () => {
    render(
      <CommunityForm
        mode="edit"
        communityId={COMMUNITY}
        initial={{ ...INITIAL, status: 'archived' }}
        tenantName="Rede Demo"
        memberMode
        relation="owner"
      />,
    );
    expect(document.querySelector('[data-community-reactivate]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Excluir comunidade' })).toBeTruthy();
    expect(document.body.textContent?.toLowerCase()).not.toContain('moderad');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir comunidade' }));
    // The owner's delete is the shipped one: no "a pessoa que criou" sentence.
    expect(screen.getByRole('dialog').textContent).not.toContain('não é avisada');
  });
});
