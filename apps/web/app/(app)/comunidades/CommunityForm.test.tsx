// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 08.2-10 — the community edit form's READ-ONLY "Acesso" block (D-363, UI-D-379, E13), against the
 * real merged pt-BR catalogs. The block lists the products that make the community exclusive as
 * links to `/loja/{id}` (archived ones suffixed), says "Aberta para todos os membros." with none,
 * and is ABSENT without its prop (store off, no permission, or a failed access read). Nothing in it
 * writes: links are edited in the product form only.
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
