// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatComposer } from '../ui/index';

/**
 * UI-D-260 as observable contract: disabled when empty, the key rules per pointer, the counter band
 * and the failure-restore rule. Sentinel strings only.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubPointer(fine: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(pointer: fine)' ? fine : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function composer(onSend: (body: string) => Promise<boolean> = vi.fn(async () => true)) {
  render(
    <ChatComposer
      label="field-sentinel"
      placeholder="placeholder-sentinel"
      sendLabel="send-sentinel"
      counterTemplate={(count) => `counter-${count}`}
      errorText="error-sentinel"
      onSend={onSend}
    />,
  );
  return {
    field: screen.getByRole('textbox', { name: 'field-sentinel' }) as HTMLTextAreaElement,
    send: screen.getByRole('button', { name: 'send-sentinel' }),
    onSend,
  };
}

describe('ChatComposer (UI-D-260)', () => {
  it('is a 16px, 2000-cap field with no attachment control', () => {
    const { field } = composer();
    expect(field).toHaveAttribute('maxLength', '2000');
    expect(field).toHaveAttribute('rows', '1');
    expect(field.className).toContain('text-base');
    expect(field).toHaveAttribute('placeholder', 'placeholder-sentinel');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('keeps send disabled for an empty or whitespace-only draft, with no error shown', () => {
    const { field, send } = composer();
    expect(send).toBeDisabled();
    fireEvent.change(field, { target: { value: '   \n  ' } });
    expect(send).toBeDisabled();
    fireEvent.change(field, { target: { value: ' Oi ' } });
    expect(send).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('on a fine pointer, Enter sends the trimmed text and Shift+Enter does not', async () => {
    stubPointer(true);
    const { field, onSend } = composer();
    fireEvent.change(field, { target: { value: ' Oi \n' } });
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });
    expect(onSend).toHaveBeenCalledWith('Oi');
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
  });

  it('on touch, Enter does not send (it is a new line); only the button sends', async () => {
    stubPointer(false);
    const { field, send, onSend } = composer();
    fireEvent.change(field, { target: { value: 'Oi' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(send);
    });
    expect(onSend).toHaveBeenCalledWith('Oi');
  });

  it('shows the counter from 1,800 characters and turns it danger at 2,000', () => {
    const { field } = composer();
    fireEvent.change(field, { target: { value: 'a'.repeat(1799) } });
    expect(document.querySelector('[data-chat-counter]')).toBeNull();
    fireEvent.change(field, { target: { value: 'a'.repeat(1800) } });
    const counter = document.querySelector('[data-chat-counter]') as HTMLElement;
    expect(counter.textContent).toBe('counter-1800');
    expect(counter.className).toContain('text-text-tertiary');
    fireEvent.change(field, { target: { value: 'a'.repeat(2000) } });
    const capped = document.querySelector('[data-chat-counter]') as HTMLElement;
    expect(capped.textContent).toBe('counter-2000');
    expect(capped.className).toContain('text-danger');
  });

  it('restores the draft and shows the inline error on failure, cleared by the next keystroke', async () => {
    const onSend = vi.fn(async () => false);
    const { field, send } = composer(onSend);
    fireEvent.change(field, { target: { value: 'Minha dúvida\ncom duas linhas' } });
    await act(async () => {
      fireEvent.click(send);
    });
    expect(onSend).toHaveBeenCalledWith('Minha dúvida\ncom duas linhas');
    expect(field.value).toBe('Minha dúvida\ncom duas linhas');
    expect(screen.getByRole('alert')).toHaveTextContent('error-sentinel');
    fireEvent.change(field, { target: { value: 'Minha dúvida\ncom duas linhas!' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a failed send keeps what was typed while it was pending, after the restored draft (B-WR-05)', async () => {
    let answer: (accepted: boolean) => void = () => {};
    const onSend = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    );
    const { field, send } = composer(onSend);
    fireEvent.change(field, { target: { value: 'Primeira' } });
    await act(async () => {
      fireEvent.click(send);
    });
    expect(field.value).toBe('');
    fireEvent.change(field, { target: { value: 'Segunda, digitada enquanto enviava' } });
    await act(async () => {
      answer(false);
    });
    expect(field.value).toBe('Primeira\nSegunda, digitada enquanto enviava');
    expect(screen.getByRole('alert')).toHaveTextContent('error-sentinel');
  });

  it('treats a rejected send as a failure', async () => {
    const onSend = vi.fn(async () => {
      throw new Error('network');
    });
    const { field, send } = composer(onSend);
    fireEvent.change(field, { target: { value: 'Oi' } });
    await act(async () => {
      fireEvent.click(send);
    });
    expect(field.value).toBe('Oi');
    expect(screen.getByRole('alert')).toHaveTextContent('error-sentinel');
  });
});
