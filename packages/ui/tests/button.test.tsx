import { render, screen } from '@testing-library/react';
import { Bell, Mail } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import {
  Badge,
  Button,
  Card,
  Chip,
  IconButton,
  Input,
  SectionTitle,
  StatusPill,
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
