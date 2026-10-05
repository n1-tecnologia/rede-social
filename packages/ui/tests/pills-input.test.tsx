import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chip, chipBase, Input, StatusPill, type StatusTone } from '../src/index';
import { chipBase as chipBaseModule } from '../src/primitives/chipBase';

/**
 * PDF item #9: the "Cancelado" / "Em breve" tags rendered square, flush and 16px regular because
 * the server graph dropped the shared geometry (see src/primitives/chipBase.ts). happy-dom has no
 * RSC transform, so these renders cannot reproduce the drop itself (tests/client-boundary.test.ts
 * pins its cause); they pin what the pill must carry once the string arrives, class by class, so a
 * lost token names itself in the failure.
 *
 * PDF item #11: the iOS date/time fields ran past the screen on the event form. Only iOS WebKit
 * draws them that way, and the e2e suite runs on Chromium, so the unit level pins the trigger: the
 * temporal types carry the appearance reset and the value-box rules, every other type does not.
 */
const GEOMETRY = chipBase.split(' ');
const TONES: StatusTone[] = ['brand', 'success', 'warning', 'danger', 'neutral'];

describe('StatusPill: the shared chip geometry (PDF #9)', () => {
  it('renders the full geometry next to the tone, not the tone alone', () => {
    render(<StatusPill tone="danger">Cancelado</StatusPill>);
    const pill = screen.getByText('Cancelado');
    expect(pill.tagName).toBe('SPAN');
    expect(pill).toHaveClass(
      'rounded-full',
      'px-3.5',
      'py-1.5',
      'text-xs',
      'font-bold',
      'whitespace-nowrap',
    );
    expect(pill).toHaveClass('bg-danger/10', 'text-danger');
  });

  it('keeps the same geometry on every tone', () => {
    render(
      <div>
        {TONES.map((tone) => (
          <StatusPill key={tone} tone={tone}>
            {tone}
          </StatusPill>
        ))}
      </div>,
    );
    for (const tone of TONES) {
      expect(screen.getByText(tone)).toHaveClass(...GEOMETRY);
    }
  });

  it('shares ONE geometry string with Chip, exported as a real string from its own module', () => {
    expect(typeof chipBase).toBe('string');
    expect(chipBase).toBe(chipBaseModule);
    render(
      <>
        <StatusPill>Arquivada</StatusPill>
        <Chip>Ativas</Chip>
      </>,
    );
    expect(screen.getByText('Arquivada')).toHaveClass(...GEOMETRY);
    expect(screen.getByText('Ativas')).toHaveClass(...GEOMETRY);
  });

  it('lets a caller class win through twMerge without losing the rest of the geometry', () => {
    render(
      <>
        <StatusPill tone="danger" className="mr-2 shrink-0">
          Cancelado
        </StatusPill>
        <StatusPill tone="warning" className="whitespace-normal">
          Convite expirado
        </StatusPill>
        <StatusPill tone="success" className="text-sm">
          Ativo
        </StatusPill>
      </>,
    );
    // The event header's margin is additive.
    expect(screen.getByText('Cancelado')).toHaveClass('mr-2', ...GEOMETRY);
    // AdminsCard lets a long invite state wrap.
    const wrapping = screen.getByText('Convite expirado');
    expect(wrapping).toHaveClass('whitespace-normal', 'rounded-full', 'px-3.5', 'py-1.5');
    expect(wrapping).not.toHaveClass('whitespace-nowrap');
    // StatusCard reads the tenant status one step larger.
    const larger = screen.getByText('Ativo');
    expect(larger).toHaveClass('text-sm', 'font-bold', 'rounded-full', 'px-3.5', 'py-1.5');
    expect(larger).not.toHaveClass('text-xs');
  });
});

describe('Input: the iOS date/time guard (PDF #11)', () => {
  const TEMPORAL = ['date', 'time', 'datetime-local', 'month', 'week'];
  const VALUE_BOX = [
    '[&::-webkit-date-and-time-value]:min-h-6',
    '[&::-webkit-date-and-time-value]:text-left',
  ];

  it.each(TEMPORAL)('type="%s" drops the native appearance and floors the value box', (type) => {
    render(<Input id="campo" label="Campo" type={type} />);
    const field = screen.getByLabelText('Campo');
    expect(field).toHaveAttribute('type', type);
    expect(field).toHaveClass('appearance-none', 'min-w-0', ...VALUE_BOX);
  });

  it.each(['text', 'email', 'url', 'search', 'password', 'number'])(
    'type="%s" keeps its native appearance and only gains min-w-0',
    (type) => {
      render(<Input id="campo" label="Campo" type={type} />);
      const field = screen.getByLabelText('Campo');
      expect(field).toHaveClass('min-w-0');
      expect(field).not.toHaveClass('appearance-none');
      expect(field.className).not.toContain('-webkit-date-and-time-value');
    },
  );

  it('treats a field without a type as text', () => {
    render(<Input id="nome" label="Nome" />);
    const field = screen.getByLabelText('Nome');
    expect(field).not.toHaveAttribute('type');
    expect(field).toHaveClass('min-w-0');
    expect(field).not.toHaveClass('appearance-none');
  });

  it('keeps the shared field geometry and the error state on a date field', () => {
    render(<Input id="inicio" label="Data de início" type="date" error="Informe a data." />);
    const field = screen.getByLabelText('Data de início');
    expect(field).toHaveClass('w-full', 'rounded-xl', 'px-4', 'py-3', 'text-base', 'border-danger');
    expect(field).toHaveClass('appearance-none', ...VALUE_BOX);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Informe a data.');
  });
});
