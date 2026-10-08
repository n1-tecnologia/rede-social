import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Avatar,
  BottomSheet,
  ConfirmDialog,
  EmptyState,
  Switch,
  Tabs,
  ToastProvider,
  useToast,
} from '../src/index';

describe('BottomSheet', () => {
  it('is a modal dialog that closes on Escape and receives focus when opened', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open title="Regras" onClose={onClose}>
        <button type="button">Entendi</button>
      </BottomSheet>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Regras' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while closed', () => {
    render(
      <BottomSheet open={false} title="Regras" onClose={() => {}}>
        conteúdo
      </BottomSheet>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('dismiss="handle" (2026-10-06): the handle is a named close control; the content is not', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open title="Comentários" onClose={onClose} dismiss="handle" handleLabel="Fechar">
        <p>linha 1</p>
      </BottomSheet>,
    );
    // A tap on the content closes nothing.
    fireEvent.pointerDown(screen.getByText('linha 1'));
    fireEvent.pointerUp(screen.getByText('linha 1'));
    fireEvent.click(screen.getByText('linha 1'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the default sheet draws a decorative handle, never a control', () => {
    render(
      <BottomSheet open title="Regras" onClose={() => {}}>
        conteúdo
      </BottomSheet>,
    );
    expect(document.querySelector('[data-sheet-handle]')).toBeNull();
  });
});

describe('ConfirmDialog', () => {
  it('disables both buttons and spins while the confirmed action runs, then closes', async () => {
    let resolveAction: () => void = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAction = resolve;
        }),
    );
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Suspender Comunidade X?"
        body="Os membros perdem o acesso imediatamente."
        confirmLabel="Suspender"
        cancelLabel="Cancelar"
        tone="danger"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Suspender Comunidade X?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    const confirm = screen.getByRole('button', { name: 'Suspender' });
    const cancel = screen.getByRole('button', { name: 'Cancelar' });
    expect(confirm.className).toContain('text-danger');

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(cancel).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveAction();
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('closes on Escape and on cancel', () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Sair?"
        confirmLabel="Sair"
        cancelLabel="Ficar"
        onConfirm={() => {}}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ficar' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('scrollBody caps the body and scrolls it inside the dialog; the default body is unchanged', () => {
    const props = {
      open: true,
      title: 'Tornar 10 comunidades exclusivas?',
      body: 'corpo longo',
      confirmLabel: 'Tornar exclusivas',
      cancelLabel: 'Voltar',
      onConfirm: () => {},
      onClose: () => {},
    };
    const { unmount } = render(<ConfirmDialog {...props} scrollBody />);
    const body = screen.getByText('corpo longo');
    expect(body.className).toContain('max-h-60');
    expect(body.className).toContain('overflow-y-auto');
    // Still the dialog's description, and both buttons are still there.
    expect(screen.getByRole('dialog').getAttribute('aria-describedby')).toBe(body.id);
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeTruthy();
    unmount();

    render(<ConfirmDialog {...props} />);
    expect(screen.getByText('corpo longo').className).not.toContain('overflow-y-auto');
  });
});

function ToastHarness({ messages }: { messages: string[] }) {
  const { show } = useToast();
  return (
    <div>
      {messages.map((message, index) => (
        <button
          key={message}
          type="button"
          onClick={() => show({ tone: index === 0 ? 'success' : 'error', message })}
        >
          {`show-${index}`}
        </button>
      ))}
    </div>
  );
}

describe('Toast', () => {
  it('announces the message and keeps a single toast, the newer replacing the older', () => {
    render(
      <ToastProvider>
        <ToastHarness messages={['Salvo com sucesso', 'Algo deu errado']} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'show-0' }));
    const first = screen.getByRole('status');
    expect(first).toHaveTextContent('Salvo com sucesso');
    expect(first).toHaveAttribute('aria-live', 'polite');
    expect(first.className).toContain('bg-success');

    fireEvent.click(screen.getByRole('button', { name: 'show-1' }));
    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toHaveTextContent('Algo deu errado');
    expect(statuses[0]?.className).toContain('bg-danger');
  });

  it('grows with a 200-character message instead of clipping to a fixed height', () => {
    const long = 'x'.repeat(200);
    render(
      <ToastProvider>
        <ToastHarness messages={[long]} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'show-0' }));
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent(long);
    expect(toast.className).not.toMatch(/(^|\s)h-\S+/);
    expect(toast.className).not.toContain('truncate');
    expect(toast.className).toContain('md:max-w-[420px]');
  });

  it('auto-dismisses after 3000 ms', async () => {
    vi.useFakeTimers();
    try {
      render(
        <ToastProvider>
          <ToastHarness messages={['Feito']} />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'show-0' }));
      expect(screen.getByRole('status')).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(2999);
      });
      expect(screen.getByRole('status')).toBeInTheDocument();
      // AnimatePresence unmounts on a microtask once the (skipped) exit settles
      await act(async () => {
        vi.advanceTimersByTime(1);
        await Promise.resolve();
      });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Switch', () => {
  it('exposes role=switch with aria-checked and toggles through onChange', () => {
    const onChange = vi.fn();
    render(<Switch checked onChange={onChange} label="Tema escuro" />);
    const toggle = screen.getByRole('switch', { name: 'Tema escuro' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle.className).toContain('bg-brand');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe('Tabs', () => {
  const items = [
    { key: 'ativos', label: 'Ativos' },
    { key: 'suspensos', label: 'Suspensos' },
    { key: 'todos', label: 'Todos' },
  ];

  it('renders a tablist with one selected tab and moves selection with the arrow keys', () => {
    const onChange = vi.fn();
    render(<Tabs items={items} value="ativos" onChange={onChange} label="Filtro" />);
    const list = screen.getByRole('tablist', { name: 'Filtro' });
    const tabs = screen.getAllByRole('tab');
    expect(list).toBeInTheDocument();
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[0]?.className).toContain('font-bold');

    fireEvent.keyDown(tabs[0] as HTMLElement, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('suspensos');
    fireEvent.keyDown(tabs[0] as HTMLElement, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('todos');
  });

  it('renders links when items carry a href', () => {
    render(
      <Tabs
        items={[{ key: 'a', label: 'Aba A', href: '/a' }]}
        value="a"
        onChange={() => {}}
        label="Navegação"
      />,
    );
    const tab = screen.getByRole('tab', { name: 'Aba A' });
    expect(tab.tagName).toBe('A');
    expect(tab).toHaveAttribute('href', '/a');
  });
});

describe('EmptyState and Avatar', () => {
  it('renders title, body and the card wrapper for variant="card"', () => {
    render(
      <EmptyState
        icon={Sparkles}
        title="Em breve"
        body="Nenhuma comunidade ainda."
        variant="card"
        data-testid="empty"
      />,
    );
    const root = screen.getByTestId('empty');
    expect(screen.getByText('Em breve')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma comunidade ainda.').className).toContain('max-w-[260px]');
    expect(root.className).toContain('bg-card');
  });

  it('renders a span by default and a button when clickable', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Avatar alt="Ana" />);
    expect(screen.getByLabelText('Ana').tagName).toBe('SPAN');
    rerender(<Avatar alt="Ana" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ana' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a className size resizes the WHOLE avatar: the visible circle fills the outer box', () => {
    // An `xl` (80px) avatar asked for `h-16 w-16` by its caller. Sized only on the inner circle,
    // it spilled 16px out of its 64px box, over whatever sat around it.
    for (const onClick of [undefined, vi.fn()]) {
      const { unmount } = render(
        <Avatar alt="Ana" size="xl" className="h-16 w-16" onClick={onClick} />,
      );
      const outer = screen.getByLabelText('Ana');
      expect(outer.className).toContain('h-16');
      expect(outer.className).toContain('w-16');
      expect(outer.className).not.toContain('h-20');
      const circle = outer.firstElementChild as HTMLElement;
      expect(circle.className).toContain('h-full');
      expect(circle.className).toContain('w-full');
      expect(circle.className).not.toContain('h-20');
      unmount();
    }
  });

  it('without a className the size map still sets the box', () => {
    render(<Avatar alt="Ana" size="lg" />);
    expect(screen.getByLabelText('Ana').className).toContain('h-14');
  });
});

describe('BottomSheet — who scrolls (#3: the comment composer covered the last row)', () => {
  /** The body is the element the children are rendered into. */
  const bodyOf = (child: HTMLElement) => child.parentElement as HTMLElement;
  const has = (element: HTMLElement, ...names: string[]) =>
    names.every((name) => element.classList.contains(name));
  const hasAny = (element: HTMLElement, ...names: string[]) =>
    names.some((name) => element.classList.contains(name));

  it('scroll="content" hands the scroll to the children: an unpadded flex column under the same cap', () => {
    render(
      <BottomSheet open title="Comentários" onClose={() => {}} scroll="content">
        <div data-testid="content" />
      </BottomSheet>,
    );
    const body = bodyOf(screen.getByTestId('content'));
    expect(has(body, 'flex', 'min-h-0', 'max-h-[calc(var(--screen-h)*0.8)]', 'flex-col')).toBe(
      true,
    );
    // No padding and no overflow: a child's footer can sit BELOW its own scrollport, flush.
    expect(hasAny(body, 'overflow-y-auto', 'overscroll-contain', 'px-4', 'py-4')).toBe(false);
    // The panel is a flex column, so a capped body shrinks instead of overflowing the panel.
    expect(has(screen.getByRole('dialog', { name: 'Comentários' }), 'flex', 'flex-col')).toBe(true);
  });

  it('the default keeps the padded, scrolling body every other sheet relies on', () => {
    render(
      <BottomSheet open title="Regras" onClose={() => {}}>
        <div data-testid="content" />
      </BottomSheet>,
    );
    const body = bodyOf(screen.getByTestId('content'));
    expect(
      has(
        body,
        'max-h-[calc(var(--screen-h)*0.8)]',
        'overflow-y-auto',
        'overscroll-contain',
        'px-4',
        'py-4',
      ),
    ).toBe(true);
    expect(has(screen.getByRole('dialog', { name: 'Regras' }), 'pb-safe')).toBe(true);
  });
});

describe('BottomSheet — focus (#4: the keyboard rose over a sheet still sliding in)', () => {
  it('initialFocus="title" focuses the heading, not the field; Tab enters the ring, Shift+Tab wraps inside', () => {
    render(
      <BottomSheet open title="Comentários" onClose={() => {}} initialFocus="title">
        <input aria-label="Comentário" />
        <button type="button">Enviar</button>
      </BottomSheet>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Comentários' });
    const heading = screen.getByRole('heading', { name: 'Comentários' });
    const field = screen.getByRole('textbox', { name: 'Comentário' });
    const send = screen.getByRole('button', { name: 'Enviar' });

    expect(heading).toHaveFocus();
    expect(field).not.toHaveFocus();
    // Focusable from code only: the heading is never a Tab stop of its own.
    expect(heading).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(heading, { key: 'Tab' });
    expect(field).toHaveFocus();

    heading.focus();
    fireEvent.keyDown(heading, { key: 'Tab', shiftKey: true });
    expect(send).toHaveFocus();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('the default still lands on the first control, and the heading stays out of the tab order', () => {
    render(
      <BottomSheet open title="Regras" onClose={() => {}}>
        <input aria-label="Busca" />
      </BottomSheet>,
    );
    expect(screen.getByRole('textbox', { name: 'Busca' })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Regras' })).not.toHaveAttribute('tabindex');
  });

  it('an open sheet re-rendered with a NEW onClose keeps the focus where it is; Escape calls the latest', () => {
    const first = vi.fn();
    const latest = vi.fn();
    // A control BEFORE the field, as the rows are in the comment sheet: re-arming the trap would
    // land on it (or on the title) and never on the field, whichever `initialFocus` is in play.
    const sheet = (onClose: () => void, initialFocus: 'first' | 'title') => (
      <BottomSheet open title="Comentários" onClose={onClose} initialFocus={initialFocus}>
        <button type="button">Curtir</button>
        <input aria-label="Comentário" />
      </BottomSheet>
    );
    for (const initialFocus of ['title', 'first'] as const) {
      first.mockClear();
      latest.mockClear();
      const { rerender, unmount } = render(sheet(first, initialFocus));
      const field = screen.getByRole('textbox', { name: 'Comentário' });
      field.focus();
      expect(field).toHaveFocus();

      // A host that passes an inline arrow re-renders with a new identity (FeedList after a
      // comment moves the card's count). Re-arming the trap here pulled the focus out of the field.
      rerender(sheet(latest, initialFocus));
      expect(field).toHaveFocus();

      fireEvent.keyDown(field, { key: 'Escape' });
      expect(latest).toHaveBeenCalledTimes(1);
      expect(first).not.toHaveBeenCalled();
      unmount();
    }
  });
});

describe('BottomSheet — closing with the keyboard up (#4: the panel lifted above it)', () => {
  /** A 300px keyboard under an 844px layout viewport, not panned: 544px stay visible. */
  class KeyboardViewport extends EventTarget {
    height = 544;
    offsetTop = 0;
    scale = 1;
  }

  const KEYS = ['innerHeight', 'visualViewport'] as const;
  const saved = new Map<(typeof KEYS)[number], PropertyDescriptor | undefined>();
  beforeEach(() => {
    for (const key of KEYS) saved.set(key, Object.getOwnPropertyDescriptor(window, key));
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  });
  afterEach(() => {
    for (const key of KEYS) {
      const descriptor = saved.get(key);
      if (descriptor) Object.defineProperty(window, key, descriptor);
      else Reflect.deleteProperty(window, key);
    }
  });

  /** Opens, closes, and returns every `transform` the panel was given until it unmounted. */
  async function exitTransforms(): Promise<{ padding: string; transforms: string[] }> {
    const sheet = (open: boolean) => (
      <BottomSheet open={open} title="Comentários" onClose={() => {}}>
        <input aria-label="Comentário" />
      </BottomSheet>
    );
    const { rerender } = render(sheet(true));
    // The keyboard is read once on activation, and that reading re-renders the sheet.
    await act(async () => {});
    const panel = screen.getByRole('dialog', { name: 'Comentários' });
    const padding = (panel.parentElement as HTMLElement).style.paddingBottom;
    const transforms: string[] = [];
    const observer = new MutationObserver(() => transforms.push(panel.style.transform));
    observer.observe(panel, { attributes: true, attributeFilter: ['style'] });
    rerender(sheet(false));
    await waitFor(() => expect(panel).not.toBeInTheDocument());
    observer.disconnect();
    return { padding, transforms };
  }

  it('the exit drops the panel by its height PLUS the padding the frozen root keeps while it leaves', async () => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: new KeyboardViewport(),
    });
    const { padding, transforms } = await exitTransforms();

    // `AnimatePresence` exits the LAST open render: its root still pads 300px, so `100%` alone
    // ended the slide on the strip the keyboard covered.
    expect(padding).toBe('300px');
    expect(transforms).toContain('translateY(calc(100% + 300px))');
  });

  it('with no keyboard the exit is the plain slide by the panel’s own height', async () => {
    const { padding, transforms } = await exitTransforms();

    expect(padding).toBe('');
    expect(transforms).toContain('translateY(100%)');
  });
});

describe('useFocusTrap — an opener that left the document (a comment deleted inside its sheet)', () => {
  /**
   * The comment list's shape, reduced: inside a sheet, rows that each open a `ConfirmDialog` from
   * their own trash control, and a confirmed delete that removes the row, trash control included,
   * BEFORE the dialog closes (the list's `confirmDelete`, then the dialog's own `finally`).
   */
  function SheetWithRows({ onCloseSheet }: { onCloseSheet: () => void }) {
    const [rows, setRows] = useState(['a', 'b']);
    const [confirming, setConfirming] = useState<string | null>(null);
    return (
      <BottomSheet open title="Comentários" onClose={onCloseSheet} initialFocus="title">
        {rows.map((row) => (
          <button key={row} type="button" onClick={() => setConfirming(row)}>
            {`excluir-${row}`}
          </button>
        ))}
        <ConfirmDialog
          open={confirming !== null}
          title="Excluir comentário?"
          confirmLabel="Excluir"
          cancelLabel="Cancelar"
          onConfirm={() => setRows((current) => current.filter((row) => row !== confirming))}
          onClose={() => setConfirming(null)}
        />
      </BottomSheet>
    );
  }

  /** Chromium focuses a clicked button, and a keyboard user is on it already: it is the opener. */
  function openConfirm(name: string): HTMLElement {
    const trash = screen.getByRole('button', { name });
    trash.focus();
    fireEvent.click(trash);
    expect(screen.getByRole('dialog', { name: 'Excluir comentário?' })).toBeInTheDocument();
    return trash;
  }

  const confirmGone = () =>
    waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Excluir comentário?' })).not.toBeInTheDocument(),
    );

  it('a confirmed delete hands the focus to the sheet around the dialog: Escape and Tab still work', async () => {
    const onCloseSheet = vi.fn();
    render(<SheetWithRows onCloseSheet={onCloseSheet} />);
    const sheet = screen.getByRole('dialog', { name: 'Comentários' });
    const trash = openConfirm('excluir-a');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    });
    await confirmGone();

    // The opener left with its row, and the focus did not fall to <body> behind the backdrop.
    expect(trash).not.toBeInTheDocument();
    expect(sheet).toHaveFocus();

    fireEvent.keyDown(sheet, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'excluir-b' })).toHaveFocus();

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(onCloseSheet).toHaveBeenCalledTimes(1);
  });

  it('a cancelled delete still returns the focus to the trash control that opened the dialog', async () => {
    render(<SheetWithRows onCloseSheet={() => {}} />);
    const trash = openConfirm('excluir-a');

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await confirmGone();
    expect(trash).toHaveFocus();
  });

  it('an opener that was <body> (iOS: a tap never focuses the trash) also hands the focus to the sheet', async () => {
    const onCloseSheet = vi.fn();
    render(<SheetWithRows onCloseSheet={onCloseSheet} />);
    const sheet = screen.getByRole('dialog', { name: 'Comentários' });
    // Dismissing the keyboard blurs the field to <body>, and the tap below focuses nothing.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(screen.getByRole('button', { name: 'excluir-a' }));
    expect(screen.getByRole('dialog', { name: 'Excluir comentário?' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await confirmGone();

    expect(sheet).toHaveFocus();
    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(onCloseSheet).toHaveBeenCalledTimes(1);
  });

  it('a control removed with its row drops the focus on <body>: Escape still closes, Tab re-enters', () => {
    // The highlight editor's "Remover" (no confirm): the focused button leaves with its row.
    function SheetWithRemovableRows({ onCloseSheet }: { onCloseSheet: () => void }) {
      const [rows, setRows] = useState(['a', 'b']);
      return (
        <BottomSheet open title="Editar destaque" onClose={onCloseSheet}>
          {rows.map((row) => (
            <button
              key={row}
              type="button"
              onClick={() => setRows((current) => current.filter((item) => item !== row))}
            >
              {`remover-${row}`}
            </button>
          ))}
        </BottomSheet>
      );
    }
    const onCloseSheet = vi.fn();
    render(<SheetWithRemovableRows onCloseSheet={onCloseSheet} />);
    const removeA = screen.getByRole('button', { name: 'remover-a' });
    removeA.focus();
    fireEvent.click(removeA);
    expect(removeA).not.toBeInTheDocument();
    // happy-dom keeps no focus on a detached node: the document falls back to <body>.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'remover-b' })).toHaveFocus();

    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCloseSheet).toHaveBeenCalledTimes(1);
  });

  it('with a dialog open inside the sheet, a stray Escape closes the dialog, never the sheet', async () => {
    const onCloseSheet = vi.fn();
    render(<SheetWithRows onCloseSheet={onCloseSheet} />);
    openConfirm('excluir-a');
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    await confirmGone();
    expect(onCloseSheet).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Comentários' })).toBeInTheDocument();
  });

  it('a dialog with no modal around it returns the focus to its opener, as before', async () => {
    function Standalone() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            abrir
          </button>
          <ConfirmDialog
            open={open}
            title="Sair?"
            confirmLabel="Sair"
            cancelLabel="Ficar"
            onConfirm={() => {}}
            onClose={() => setOpen(false)}
          />
        </>
      );
    }
    render(<Standalone />);
    const opener = screen.getByRole('button', { name: 'abrir' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('button', { name: 'Ficar' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Ficar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });
});
