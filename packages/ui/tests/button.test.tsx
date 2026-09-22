import { fireEvent, render, screen } from '@testing-library/react';
import { Bell, Mail } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import {
  Badge,
  Button,
  Card,
  Chip,
  IconButton,
  Input,
  PageHeader,
  SearchBar,
  SectionTitle,
  StatusPill,
  Textarea,
} from '../src/index';

describe('Button', () => {
  it('renders the brand variant with the tenant-bound utilities', () => {
    render(<Button variant="brand">Entrar</Button>);
    const button = screen.getByRole('button', { name: 'Entrar' });
    expect(button.className).toContain('bg-brand');
    expect(button.className).toContain('text-on-brand');
    expect(button.className).toContain('hover:bg-brand-hover');
    expect(button).toHaveAttribute('type', 'button');
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
