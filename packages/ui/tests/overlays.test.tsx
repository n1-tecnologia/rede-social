import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Sparkles } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
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

  it('auto-dismisses after 3000 ms', () => {
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
      act(() => {
        vi.advanceTimersByTime(1);
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
});
