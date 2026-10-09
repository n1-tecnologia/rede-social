import { fireEvent, render, screen } from '@testing-library/react';
import { Bell, Mail } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Badge,
  Button,
  Card,
  Chip,
  cn,
  IconButton,
  Input,
  PageHeader,
  recordAppPath,
  resetBackStack,
  SearchBar,
  SectionTitle,
  StatusPill,
  startBackStack,
  Textarea,
} from '../src/index';

describe('Button', () => {
  it('renders the brand variant with the tenant-bound utilities', () => {
    render(<Button variant="brand">Entrar</Button>);
    const button = screen.getByRole('button', { name: 'Entrar' });
    // 2026-10-03: the button colour, its own token (the primary unless one is set)...
    expect(button.className).toContain('bg-button');
    expect(button.className).toContain('text-on-button');
    expect(button.className).toContain('hover:bg-button-hover');
    expect(button.className).not.toMatch(
      /(^|\s)(bg-brand|text-on-brand|hover:bg-brand-hover)(\s|$)/,
    );
    // ...while the focus ring stays on the primary.
    expect(button.className).toContain('focus-visible:ring-brand');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('defaults to the brand variant', () => {
    render(<Button>Continuar</Button>);
    const button = screen.getByRole('button', { name: 'Continuar' });
    expect(button.className).toContain('bg-button');
    expect(button.className).toContain('text-on-button');
  });

  /**
   * The gradient button (2026-10-03, second round): an image over the fill, `none` unless the
   * tenant's buttons are a gradient (tokens.css), so a solid tenant paints exactly as before.
   */
  describe('the gradient button image', () => {
    const IMAGE = 'bg-(image:--button-image)';
    const IMAGE_HOVER = 'hover:bg-(image:--button-image-hover)';

    it('the brand variant carries the image and its hover next to the fill and its hover', () => {
      render(<Button>Entrar</Button>);
      const button = screen.getByRole('button', { name: 'Entrar' });
      for (const cls of ['bg-button', IMAGE, 'hover:bg-button-hover', IMAGE_HOVER]) {
        expect(button.classList.contains(cls), cls).toBe(true);
      }
    });

    it('only the filled brand variant: the others never paint the image', () => {
      for (const variant of ['secondary', 'outline', 'ghost', 'danger'] as const) {
        const { unmount } = render(<Button variant={variant}>Outro</Button>);
        const button = screen.getByRole('button', { name: 'Outro' });
        expect(button.className, variant).not.toContain('--button-image');
        unmount();
      }
    });

    it('tailwind-merge keeps the fill and the image together (two utility groups)', () => {
      expect(cn('bg-button', IMAGE)).toBe(`bg-button ${IMAGE}`);
      expect(cn('hover:bg-button-hover', IMAGE_HOVER)).toBe(`hover:bg-button-hover ${IMAGE_HOVER}`);
      // A caller's layout classes leave all four in place.
      render(<Button className="w-full md:w-auto">Salvar</Button>);
      const tokens = screen.getByRole('button', { name: 'Salvar' }).className.split(/\s+/);
      expect(tokens).toEqual(
        expect.arrayContaining([
          'bg-button',
          IMAGE,
          'hover:bg-button-hover',
          IMAGE_HOVER,
          'w-full',
        ]),
      );
    });

    it('a caller colour still replaces the fill as before; bg-none also takes the image away', () => {
      // As it did before the image, `bg-danger` wins over `bg-button`. The image is another group
      // and stays (`none` without a gradient, so the caller's colour shows exactly as before).
      render(<Button className="bg-danger hover:bg-danger/90">Excluir</Button>);
      const repainted = screen.getByRole('button', { name: 'Excluir' }).className.split(/\s+/);
      expect(repainted).toEqual(expect.arrayContaining(['bg-danger', 'hover:bg-danger/90']));
      expect(repainted).not.toContain('bg-button');
      expect(repainted).not.toContain('hover:bg-button-hover');
      expect(repainted).toEqual(expect.arrayContaining([IMAGE, IMAGE_HOVER]));
      // `bg-none` alone takes the image, never its hover (a variant is a group of its own): under
      // a gradient the tenant's hovered image would still cover `hover:bg-danger/90`. Hence the
      // docblock's `bg-none hover:bg-none`.
      render(<Button className="bg-danger bg-none hover:bg-danger/90">Apagar</Button>);
      const half = screen.getByRole('button', { name: 'Apagar' }).className.split(/\s+/);
      expect(half).not.toContain(IMAGE);
      expect(half).toContain(IMAGE_HOVER);
      // Under a gradient the image would cover that colour: a caller repainting a brand button
      // passes `bg-none` (and `hover:bg-none`) too, and the image goes.
      render(
        <Button className="bg-danger bg-none hover:bg-danger/90 hover:bg-none">Remover</Button>,
      );
      const plain = screen.getByRole('button', { name: 'Remover' }).className.split(/\s+/);
      expect(plain).toEqual(expect.arrayContaining(['bg-danger', 'bg-none', 'hover:bg-none']));
      expect(plain).not.toContain(IMAGE);
      expect(plain).not.toContain(IMAGE_HOVER);
      expect(plain).not.toContain('bg-button');
    });
  });

  it('exposes aria-busy and disables itself while loading', () => {
    render(<Button loading>Salvando</Button>);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
  });

  it('maps sizes and fullWidth to the spec classes', () => {
    render(
      <Button size="sm" fullWidth>
        Pequeno
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button.className).toContain('h-9');
    expect(button.className).toContain('w-full');
  });

  it('uses a visible focus ring instead of removing the outline', () => {
    render(<Button>Foco</Button>);
    const button = screen.getByRole('button');
    expect(button.className).toContain('focus-visible:ring-2');
    expect(button.className).not.toContain('focus:outline-none');
  });
});

describe('IconButton', () => {
  it('requires a label and renders it as aria-label with a count badge', () => {
    render(<IconButton label="Notificações" count={3} icon={Bell} />);
    const button = screen.getByRole('button', { name: 'Notificações' });
    expect(button).toHaveAttribute('aria-label', 'Notificações');
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('caps the count at 99+', () => {
    render(<IconButton label="Mensagens" count={120} icon={Mail} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('renders no badge for a zero count', () => {
    render(<IconButton label="Mensagens" count={0} icon={Mail} />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});

describe('Badge', () => {
  it('renders nothing for a non-positive count', () => {
    const { container } = render(<Badge count={0} />);
    expect(container).toBeEmptyDOMElement();
    const { container: dot } = render(<Badge count={0} variant="dot" />);
    expect(dot).toBeEmptyDOMElement();
  });

  it('caps the numeral at 99+', () => {
    render(<Badge count={120} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('draws the 12px dot with no numeral, aria-hidden (UI-D-253, D-237)', () => {
    const { container } = render(<Badge count={1} variant="dot" />);
    const dot = container.firstElementChild as HTMLElement;
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot.className).toContain('h-3 w-3 rounded-full bg-danger ring-2 ring-bg-secondary');
    expect(dot).toHaveTextContent('');
  });
});

describe('Input', () => {
  it('links the explicit id to its label and announces the error', () => {
    render(<Input id="email" label="E-mail" error="Inválido" />);
    const label = screen.getByText('E-mail');
    expect(label.tagName).toBe('LABEL');
    expect(label).toHaveAttribute('for', 'email');
    const input = screen.getByLabelText('E-mail');
    expect(input).toHaveAttribute('id', 'email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('Inválido');
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
    expect(input.className).toContain('border-danger');
  });

  it('keeps 16px text and pads for a leading icon', () => {
    render(<Input id="q" label="Buscar" icon={Mail} />);
    const input = screen.getByLabelText('Buscar');
    expect(input.className).toContain('text-base');
    expect(input.className).toContain('pl-10');
    expect(input).not.toHaveAttribute('aria-invalid');
  });
});

describe('SearchBar', () => {
  it('is a 44px, 16px search field named by its required aria-label (UI-D-04)', () => {
    render(
      <SearchBar
        value=""
        onChange={() => {}}
        ariaLabel="Buscar por nome"
        clearLabel="Limpar busca"
        placeholder="Buscar por nome"
      />,
    );
    const field = screen.getByLabelText('Buscar por nome');
    expect(field).toHaveAttribute('type', 'search');
    expect(field.className).toContain('h-11');
    expect(field.className).toContain('text-base');
    expect(field.className).toContain('rounded-full');
    // The prototype's 14px pill is the thing UI-D-04 departs from.
    expect(field.className).not.toContain('text-sm');
  });

  it('shows the clear control ONLY when the value is non-empty', () => {
    const { rerender } = render(
      <SearchBar value="" onChange={() => {}} ariaLabel="Buscar" clearLabel="Limpar busca" />,
    );
    expect(screen.queryByRole('button', { name: 'Limpar busca' })).not.toBeInTheDocument();

    rerender(
      <SearchBar value="gon" onChange={() => {}} ariaLabel="Buscar" clearLabel="Limpar busca" />,
    );
    expect(screen.getByRole('button', { name: 'Limpar busca' })).toBeInTheDocument();
  });

  it('is controlled: typing and clearing both report through onChange and never self-mutate', () => {
    const onChange = vi.fn();
    render(
      <SearchBar value="gon" onChange={onChange} ariaLabel="Buscar" clearLabel="Limpar busca" />,
    );
    const field = screen.getByLabelText('Buscar') as HTMLInputElement;

    fireEvent.change(field, { target: { value: 'goncal' } });
    expect(onChange).toHaveBeenCalledWith('goncal');
    // The caller owns the value: without a re-render the field still shows what it was given.
    expect(field.value).toBe('gon');

    fireEvent.click(screen.getByRole('button', { name: 'Limpar busca' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });
});

describe('PageHeader', () => {
  it('renders the title as the screen h1', () => {
    render(<PageHeader title="Membros" backHref="/perfil" backLabel="Voltar" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Membros' })).toBeInTheDocument();
  });

  it('renders NO heading when the title is omitted, so the body owns the one h1', () => {
    render(<PageHeader backHref="/membros" backLabel="Voltar" />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar' })).toHaveAttribute('href', '/membros');
  });

  // 2026-10-02: the offset counts from the scroll root's padded content edge (safe-top + 3.5rem),
  // so -0.5rem pins the header flush under the TopBar (safe-top + 3rem) on any inset. The old default
  // calc(var(--safe-top) + 3rem) counted both twice: a ~67px band and the header over the content.
  it('pins flush under the TopBar by default (-0.5rem) and is static from md up', () => {
    const { container } = render(
      <PageHeader title="Evento" backHref="/eventos" backLabel="Voltar" />,
    );
    const header = container.querySelector('header') as HTMLElement;
    expect(header.style.top).toBe('-0.5rem');
    expect(header.className).toContain('sticky');
    expect(header.className).toContain('md:static');
  });

  it('an explicit stickyTop still wins over the default', () => {
    const { container } = render(
      <PageHeader title="Evento" backHref="/eventos" backLabel="Voltar" stickyTop="0px" />,
    );
    expect((container.querySelector('header') as HTMLElement).style.top).toBe('0px');
  });

  /**
   * 2026-10-09: the back control is a `BackLink`. With an app screen behind (the shell recorded
   * Perfil, then Configurações) a plain click steps back through history; otherwise the href, the
   * screen's static parent, navigates as any link does.
   */
  describe('the back link returns to the previous screen', () => {
    beforeEach(() => {
      resetBackStack();
      window.history.replaceState(null, '', '/perfil');
    });

    afterEach(() => {
      vi.restoreAllMocks();
      resetBackStack();
    });

    /**
     * A click on the link: whether a handler prevented its navigation. The document-level listener
     * runs after React's root and settles the default, so happy-dom never follows the href.
     */
    function click(link: HTMLElement, init: MouseEventInit = {}): boolean {
      let prevented = false;
      const settle = (event: Event) => {
        prevented = event.defaultPrevented;
        event.preventDefault();
      };
      document.addEventListener('click', settle);
      fireEvent.click(link, init);
      document.removeEventListener('click', settle);
      return prevented;
    }

    function settings() {
      render(<PageHeader title="Configurações" backHref="/perfil" backLabel="Voltar" />);
      return screen.getByRole('link', { name: 'Voltar' });
    }

    /** The shell mounted on Perfil, then a soft navigation to Configurações. */
    function fromPerfil() {
      startBackStack();
      window.history.pushState(null, '', '/configuracoes');
      recordAppPath('/configuracoes');
    }

    it('a plain click with an app screen behind steps back instead of following the href', () => {
      fromPerfil();
      const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
      const link = settings();
      expect(link).toHaveAttribute('href', '/perfil');
      expect(click(link)).toBe(true);
      expect(back).toHaveBeenCalledTimes(1);
    });

    it('a new tab or window and the middle button stay with the browser', () => {
      fromPerfil();
      const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
      const link = settings();
      for (const init of [
        { ctrlKey: true },
        { metaKey: true },
        { shiftKey: true },
        { altKey: true },
        { button: 1 },
      ]) {
        expect(click(link, init), JSON.stringify(init)).toBe(false);
      }
      expect(back).not.toHaveBeenCalled();
    });

    it('with nothing behind (a page opened by its address) the href navigates as before', () => {
      window.history.replaceState(null, '', '/configuracoes');
      startBackStack();
      const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
      expect(click(settings())).toBe(false);
      expect(back).not.toHaveBeenCalled();
    });
  });
});

describe('Textarea', () => {
  it('links the label, the counter and the error, and keeps the field 16px and unresizable', () => {
    render(
      <Textarea id="bio" label="Bio" counter={{ value: 12, max: 150 }} maxLength={150} rows={3} />,
    );
    const label = screen.getByText('Bio');
    expect(label).toHaveAttribute('for', 'bio');
    const field = screen.getByLabelText('Bio');
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).toHaveAttribute('maxlength', '150');
    expect(field).toHaveAttribute('rows', '3');
    expect(field.className).toContain('text-base');
    expect(field.className).toContain('resize-none');
    expect(field.className).toContain('rounded-xl');

    const counter = screen.getByText('12/150');
    expect(counter).toHaveAttribute('aria-live', 'off');
    expect(counter.className).toContain('tabular-nums');
    expect(counter.className).toContain('text-text-tertiary');
    expect(field.getAttribute('aria-describedby')).toBe(counter.id);
  });

  it('turns the counter danger at the cap', () => {
    render(<Textarea id="bio" label="Bio" counter={{ value: 150, max: 150 }} maxLength={150} />);
    expect(screen.getByText('150/150').className).toContain('text-danger');
  });

  it('announces the error and describes the field with both the counter and the error', () => {
    render(
      <Textarea
        id="bio"
        label="Bio"
        counter={{ value: 3, max: 150 }}
        error="Bio muito longa."
        maxLength={150}
      />,
    );
    const field = screen.getByLabelText('Bio');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.className).toContain('border-danger');
    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('Bio muito longa.');
    expect(field.getAttribute('aria-describedby')).toBe(`bio-counter ${error.id}`);
  });
});

describe('Chip and StatusPill', () => {
  it('renders a pressed button chip when interactive', () => {
    const onClick = vi.fn();
    render(
      <Chip active onClick={onClick}>
        Ativos
      </Chip>,
    );
    const chip = screen.getByRole('button', { name: 'Ativos' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(chip.className).toContain('bg-brand');
    expect(chip.className).toContain('text-on-brand');
    chip.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders an anchor chip when given a href', () => {
    render(<Chip href="/eventos">Eventos</Chip>);
    const link = screen.getByRole('link', { name: 'Eventos' });
    expect(link).toHaveAttribute('href', '/eventos');
    expect(link.className).toContain('bg-bg-input');
  });

  it('renders a non-interactive soft pill per tone', () => {
    render(<StatusPill tone="success">Verificado</StatusPill>);
    const pill = screen.getByText('Verificado');
    expect(pill.tagName).toBe('SPAN');
    expect(pill.className).toContain('bg-success/10');
    expect(pill.className).toContain('text-success');
  });
});

describe('Card and SectionTitle', () => {
  it('renders the card surface classes', () => {
    render(<Card data-testid="card">conteúdo</Card>);
    const card = screen.getByTestId('card');
    expect(card.className).toContain('bg-card');
    expect(card.className).toContain('rounded-xl');
    expect(card.className).toContain('dark:border');
  });

  it('renders micro and group section titles', () => {
    render(
      <>
        <SectionTitle variant="micro">Destaques</SectionTitle>
        <SectionTitle variant="group">Conta</SectionTitle>
      </>,
    );
    expect(screen.getByText('Destaques').className).toContain('text-brand');
    expect(screen.getByText('Destaques').className).toContain('uppercase');
    expect(screen.getByText('Conta').className).toContain('text-text-secondary');
  });
});
