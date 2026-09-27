import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from '../src/index';

/**
 * 06-03 — `SegmentedControl` (UI-D-206, sketch 006 surface 2): the recorded two-option answer.
 *
 * The claim that matters most is the negative one: moving focus never writes an answer. A radiogroup
 * would call `onChange` on ArrowRight; this primitive has no key handler, so Tab, the arrows, Home and
 * End only ever move focus.
 */

const OPTIONS = [
  { value: 'going', label: 'Vou' },
  { value: 'not_going', label: 'Não vou' },
];

function renderControl(props: Partial<Parameters<typeof SegmentedControl>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <SegmentedControl
      label="Você vai a este evento?"
      options={OPTIONS}
      value={null}
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange };
}

const option = (name: string) => screen.getByRole('button', { name });

describe('SegmentedControl', () => {
  it('is a group named by its visible label, holding two type="button" options', () => {
    renderControl();
    const group = screen.getByRole('group', { name: 'Você vai a este evento?' });
    expect(group.className).toContain('grid-cols-2');
    expect(group.className).toContain('bg-bg-input');
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toHaveAttribute('type', 'button');
      expect(button.className).toContain('h-11');
      expect(button.className).toContain('whitespace-nowrap');
    }
    // Not a radiogroup: arrow-key radio semantics would write an answer as focus moves.
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('can be labelled by an element the caller renders', () => {
    render(
      <>
        <p id="own-label">Formato</p>
        <SegmentedControl
          labelId="own-label"
          options={[
            { value: 'in_person', label: 'Presencial' },
            { value: 'online', label: 'Online' },
          ]}
          value="online"
          onChange={() => {}}
        />
      </>,
    );
    expect(screen.getByRole('group', { name: 'Formato' })).toBeInTheDocument();
  });

  it('unanswered: both options idle, neither pressed', () => {
    renderControl();
    expect(option('Vou')).toHaveAttribute('aria-pressed', 'false');
    expect(option('Não vou')).toHaveAttribute('aria-pressed', 'false');
    expect(option('Vou').className).toContain('text-text-secondary');
    expect(option('Não vou').className).toContain('text-text-secondary');
  });

  it('aria-pressed follows value, and both answers carry the SAME selected style', () => {
    const { rerender } = render(
      <SegmentedControl label="Q" options={OPTIONS} value="going" onChange={() => {}} />,
    );
    expect(option('Vou')).toHaveAttribute('aria-pressed', 'true');
    expect(option('Não vou')).toHaveAttribute('aria-pressed', 'false');
    const goingClasses = option('Vou').className;
    expect(goingClasses).toContain('bg-card');
    expect(goingClasses).toContain('shadow-sm');
    // The leading brand Check is the control's only brand ink, and it is not a fill.
    expect(option('Vou').querySelector('svg')?.getAttribute('class')).toContain('text-brand');
    expect(goingClasses).not.toContain('bg-brand');

    rerender(
      <SegmentedControl label="Q" options={OPTIONS} value="not_going" onChange={() => {}} />,
    );
    expect(option('Vou')).toHaveAttribute('aria-pressed', 'false');
    expect(option('Não vou')).toHaveAttribute('aria-pressed', 'true');
    expect(option('Não vou').className).toBe(goingClasses);
    expect(option('Vou').querySelector('svg')).toBeNull();
  });

  it('a click calls onChange once with the option value', () => {
    const { onChange } = renderControl();
    fireEvent.click(option('Não vou'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('not_going');
  });

  it('moving focus (Tab, ArrowRight, ArrowLeft, Home, End) NEVER calls onChange', () => {
    const { onChange } = renderControl({ value: 'going' });
    const vou = option('Vou');
    const naoVou = option('Não vou');

    vou.focus();
    expect(document.activeElement).toBe(vou);
    for (const key of ['Tab', 'ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
      fireEvent.keyDown(vou, { key });
      fireEvent.keyUp(vou, { key });
    }
    naoVou.focus();
    expect(document.activeElement).toBe(naoVou);
    for (const key of ['ArrowLeft', 'Home', 'End']) {
      fireEvent.keyDown(naoVou, { key });
      fireEvent.keyUp(naoVou, { key });
    }
    fireEvent.blur(naoVou);

    expect(onChange).not.toHaveBeenCalled();
    // Nothing moved the pressed state either.
    expect(vou).toHaveAttribute('aria-pressed', 'true');
  });

  it('disabled: the group is inert at 50% and the stored answer stays pressed', () => {
    const { onChange } = renderControl({ value: 'not_going', disabled: true });
    const group = screen.getByRole('group');
    expect(group.className).toContain('opacity-50');
    expect(group).toHaveAttribute('aria-disabled', 'true');
    expect(option('Vou')).toBeDisabled();
    expect(option('Não vou')).toBeDisabled();
    expect(option('Não vou')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(option('Vou'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('busy: aria-busy on the group and both options disabled', () => {
    const { onChange } = renderControl({ value: 'going', busy: true });
    const group = screen.getByRole('group');
    expect(group).toHaveAttribute('aria-busy', 'true');
    expect(option('Vou')).toBeDisabled();
    expect(option('Não vou')).toBeDisabled();
    // The optimistic pressed state still shows while the write runs.
    expect(option('Vou')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(option('Não vou'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('carries no aria-busy or aria-disabled when idle', () => {
    renderControl();
    const group = screen.getByRole('group');
    expect(group).not.toHaveAttribute('aria-busy');
    expect(group).not.toHaveAttribute('aria-disabled');
  });
});
