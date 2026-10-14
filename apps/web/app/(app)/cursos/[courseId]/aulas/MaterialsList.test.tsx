// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialDraft } from '@/lib/courses-view';

/**
 * 08.3-09 — the materials list (UI-D-399, D-410, E10), against the REAL merged pt-BR catalogs.
 * Stubbed: the upload hook (its state is set per case). Real: the list, the module's `ReorderList`,
 * `FileDropZone`, the buttons. The web workspace has no jest-dom: plain DOM assertions only.
 */

const { upload } = vi.hoisted(() => ({
  upload: {
    state: 'idle' as string,
    progress: 0,
    error: null as string | null,
    pick: vi.fn(),
    reject: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
  },
}));

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

// A FULL mock: the real module imports the profile's server actions, whose env validation has no
// place in a component test. `formatMediaLimit` mirrors the hook's own rounding ("50 MB").
vi.mock('@/components/media/useSignedUpload', () => ({
  formatMediaLimit: (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
  },
  useSignedUpload: () => upload,
}));

const { MaterialsList } = await import('./MaterialsList');

const ids = Array.from(
  { length: 12 },
  (_, i) => `${String(i + 1).padStart(8, '0')}-0000-4000-8000-000000000000`,
);

const PDF: MaterialDraft = {
  assetId: ids[0] as string,
  materialId: ids[10] as string,
  filename: 'Protocolo de marcação.pdf',
  mime: 'application/pdf',
  bytes: 2_516_582,
};
const XLSX: MaterialDraft = {
  assetId: ids[1] as string,
  materialId: ids[11] as string,
  filename: 'Tabela de doses.xlsx',
  mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  bytes: 184_320,
};
const FRESH: MaterialDraft = {
  assetId: ids[2] as string,
  materialId: null,
  filename: 'Slides.pptx',
  mime: 'application/vnd.ms-powerpoint',
  bytes: 4096,
};

function renderList(items: MaterialDraft[], overrides: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  const onOpen = vi.fn();
  const view = render(
    <MaterialsList items={items} onChange={onChange} onOpen={onOpen} {...overrides} />,
  );
  return { view, onChange, onOpen };
}

const count = () => document.querySelector('[data-materials-count]')?.textContent;
const metas = () =>
  Array.from(document.querySelectorAll('[data-material-meta]')).map((node) => node.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  upload.state = 'idle';
  upload.progress = 0;
  upload.error = null;
});
afterEach(cleanup);

describe('MaterialsList (UI-D-399, D-410)', () => {
  it('E10 empty: "0/10", no list, the dropzone, "Adicionar arquivo" and the helper from the contract', () => {
    renderList([]);
    expect(screen.getByRole('heading', { level: 3, name: 'Materiais' })).toBeTruthy();
    expect(count()).toBe('0/10');
    expect(screen.queryByTestId('lesson-materials')).toBeNull();
    expect(document.getElementById('material-dropzone')).toBeTruthy();
    expect(screen.getByText('Arraste um arquivo ou toque para escolher')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Adicionar arquivo' })).toBeTruthy();
    expect(
      screen.getByText('Até 10 arquivos de até 50 MB cada: PDF, planilhas, slides e imagens.'),
    ).toBeTruthy();
    expect(document.querySelector('[data-materials-cap]')).toBeNull();
  });

  it('E10 populated: two saved rows with glyph, name, kind · size, arrows and remove, in an <ol> named by the heading', () => {
    renderList([PDF, XLSX]);
    expect(count()).toBe('2/10');
    const list = screen.getByRole('list', { name: 'Materiais' });
    expect(list.tagName).toBe('OL');
    expect(metas()).toEqual(['PDF · 2,4 MB', 'Planilha · 180 KB']);
    expect(screen.getByRole('button', { name: 'Protocolo de marcação.pdf' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remover Protocolo de marcação.pdf' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Mover para cima: Tabela de doses.xlsx' }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: 'Mover para cima: Protocolo de marcação.pdf',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole('button', {
          name: 'Mover para baixo: Tabela de doses.xlsx',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    // E10 long-text: the name truncates by CSS inside the flexible child.
    const name = screen.getByRole('button', { name: 'Protocolo de marcação.pdf' });
    expect(name.className).toContain('truncate');
    expect(name.parentElement?.className).toContain('min-w-0');
  });

  it('E10 zero-one-many: one row disables both arrows; a fresh upload is plain text (not openable yet)', () => {
    renderList([FRESH]);
    expect(
      (screen.getByRole('button', { name: 'Mover para cima: Slides.pptx' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Mover para baixo: Slides.pptx' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Slides.pptx' })).toBeNull();
    expect(screen.getByText('Slides.pptx')).toBeTruthy();
    expect(metas()).toEqual(['Slides · 4 KB']);
  });

  it('a move calls onChange with the permutation; remove calls it without the item; a saved name calls onOpen', () => {
    const { onChange, onOpen } = renderList([PDF, XLSX]);
    fireEvent.click(screen.getByRole('button', { name: 'Mover para cima: Tabela de doses.xlsx' }));
    expect(onChange).toHaveBeenLastCalledWith([XLSX, PDF]);
    fireEvent.click(screen.getByRole('button', { name: 'Remover Protocolo de marcação.pdf' }));
    expect(onChange).toHaveBeenLastCalledWith([XLSX]);
    fireEvent.click(screen.getByRole('button', { name: 'Tabela de doses.xlsx' }));
    expect(onOpen).toHaveBeenCalledWith(XLSX.materialId);
  });

  it('E10 overflow / zero-one-many: at 10 the dropzone and the button leave the DOM and the cap line shows', () => {
    const ten = ids.slice(0, 10).map((id, i) => ({ ...PDF, assetId: id, filename: `m${i}.pdf` }));
    renderList(ten);
    expect(count()).toBe('10/10');
    expect(document.getElementById('material-dropzone')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Adicionar arquivo' })).toBeNull();
    expect(document.querySelector('[data-materials-cap]')?.textContent).toBe(
      'Limite de 10 arquivos por aula.',
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
  });

  it('E10 loading: an uploading row shows "{percent}% enviado" in place of the meta and no arrows', () => {
    upload.state = 'progress';
    upload.progress = 37;
    renderList([PDF]);
    // The pending row has no name until a pick happened in THIS render; the progress line is there.
    const pending = document.querySelector('[data-material-uploading]') as HTMLElement;
    expect(pending).toBeTruthy();
    expect(pending.textContent).toContain('37% enviado');
    expect(pending.querySelector('[data-reorder-move]')).toBeNull();
    // The button is inert while a file is in flight.
    expect(
      (screen.getByRole('button', { name: 'Adicionar arquivo' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("E10 error: a zone refusal is the zone's own error slot; a server error rides under the list", () => {
    upload.state = 'error';
    upload.error = 'Arquivo muito grande. O limite é 50 MB.';
    renderList([PDF], { error: 'Você pode anexar até 10 arquivos.' });
    expect(screen.getByText('Arquivo muito grande. O limite é 50 MB.')).toBeTruthy();
    expect(document.querySelector('[data-material-failed]')).toBeNull();
    expect(document.querySelector('[data-materials-error]')?.textContent).toBe(
      'Você pode anexar até 10 arquivos.',
    );
  });

  it('disabled: arrows, removes, the name and the zone are inert while the host saves', () => {
    renderList([PDF, XLSX], { disabled: true });
    expect(
      (
        screen.getByRole('button', {
          name: 'Mover para cima: Tabela de doses.xlsx',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole('button', {
          name: 'Remover Protocolo de marcação.pdf',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Protocolo de marcação.pdf' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Adicionar arquivo' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
