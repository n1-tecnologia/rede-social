// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatComposer, type ChatComposerVoice, type VoiceTake } from '../ui/index';
import {
  domError,
  fakeClock,
  installRecording,
  uninstallRecording,
  voiceBundle,
} from './voice-fakes';

/**
 * 12.5-13 as observable contract: the composer's microphone slot and recording row over fakes.
 * Sentinel strings only; no real microphone, no real clock.
 */

let clock: ReturnType<typeof fakeClock>;
let rec: ReturnType<typeof installRecording>;

beforeEach(() => {
  clock = fakeClock();
  rec = installRecording();
});

afterEach(() => {
  cleanup();
  clock.restore();
  uninstallRecording();
});

function reinstall(options?: Parameters<typeof installRecording>[0]) {
  uninstallRecording();
  rec = installRecording(options);
}

function mount(
  voice: ChatComposerVoice | null = voiceBundle(),
  extra: { disabled?: boolean; onSend?: (body: string) => Promise<boolean> } = {},
) {
  const view = render(
    <ChatComposer
      label="field-sentinel"
      placeholder="placeholder-sentinel"
      sendLabel="send-sentinel"
      counterTemplate={(count) => `counter-${count}`}
      errorText="error-sentinel"
      onSend={extra.onSend ?? vi.fn(async () => true)}
      disabled={extra.disabled}
      voice={voice ?? undefined}
    />,
  );
  return {
    ...view,
    field: () => document.querySelector('textarea') as HTMLTextAreaElement,
    mic: () => screen.getByRole('button', { name: 'mic-sentinel' }),
  };
}

/** Flush the microtasks the fake permission prompt and the recorder's `start` event need. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ChatComposer voice, the tracer (D-849, D-851, VOICE-07, VOICE-09)', () => {
  it('asks for nothing on mount, focus or typing, and shows the enabled microphone', () => {
    const { field, mic } = mount();
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: 'oi' } });
    fireEvent.change(field(), { target: { value: '' } });
    expect(rec.getUserMedia).not.toHaveBeenCalled();
    expect(mic()).toBeEnabled();
    expect(mic()).toHaveAttribute('type', 'button');
  });

  it('one tap records and one tap sends: the host gets a take with a bare mime and every track stopped', async () => {
    const onSendVoice = vi.fn(async () => true);
    const { mic } = mount(voiceBundle({ onSendVoice }));
    const slot = mic();

    await act(async () => {
      fireEvent.click(slot);
    });
    await settle();
    expect(rec.getUserMedia).toHaveBeenCalledTimes(1);

    // The recording row: trash, the pill (word and counter) and the send, the same element as the microphone.
    expect(screen.getByRole('button', { name: 'discard-sentinel' })).toBeInTheDocument();
    expect(screen.getByText('recording-sentinel')).toBeInTheDocument();
    expect(screen.getByRole('timer', { name: 'timer-sentinel' })).toHaveTextContent('0:00');
    const send = screen.getByRole('button', { name: 'voice-send-sentinel' });
    expect(send).toBe(slot);

    await act(async () => {
      clock.advance(3000);
    });
    expect(screen.getByRole('timer', { name: 'timer-sentinel' })).toHaveTextContent('0:03');

    await act(async () => {
      fireEvent.click(send);
    });
    await settle();

    expect(onSendVoice).toHaveBeenCalledTimes(1);
    const calls = onSendVoice.mock.calls as unknown as Array<
      [{ blob: Blob; mime: string; seconds: number }]
    >;
    const take = calls[0]?.[0];
    expect(take?.mime).toBe('audio/webm');
    expect(take?.blob.size).toBeGreaterThan(0);
    expect(take?.seconds).toBeGreaterThanOrEqual(3);
    expect(rec.track.stop).toHaveBeenCalledTimes(1);

    // Back to idle, focus on the slot button.
    expect(screen.getByRole('button', { name: 'mic-sentinel' })).toBe(slot);
    expect(document.activeElement).toBe(slot);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Task 3: the composer's visual and accessibility contract (UI-D-841..845, UI-D-855)
// ---------------------------------------------------------------------------------------------------------------

async function record(view: ReturnType<typeof mount>) {
  await act(async () => {
    fireEvent.click(view.mic());
  });
  await settle();
}

const notice = () => document.querySelector('[data-chat-voice-notice]') as HTMLElement | null;
const status = () => document.querySelector('[data-chat-voice-status]') as HTMLElement;
const slot = () => document.querySelector('[data-chat-voice-slot]') as HTMLButtonElement;
const advance = (ms: number) => act(() => clock.advance(ms));

describe('the shared slot (UI-D-841, VOICE-07)', () => {
  it('is ONE element across idle, text, requesting and recording and keeps focus', async () => {
    reinstall({ deferred: true });
    const view = mount();
    const element = slot();
    element.focus();
    expect(element).toHaveAttribute('type', 'button');

    fireEvent.change(view.field(), { target: { value: 'oi' } });
    expect(slot()).toBe(element);
    expect(element).toHaveAttribute('type', 'submit');
    expect(element).toHaveAccessibleName('send-sentinel');
    fireEvent.change(view.field(), { target: { value: '' } });
    expect(element).toHaveAttribute('type', 'button');

    await record(view);
    expect(slot()).toBe(element);
    expect(element).toHaveAttribute('aria-busy', 'true');
    expect(element).toHaveAccessibleName('requesting-sentinel');
    expect(element.querySelector('svg.motion-safe\\:animate-spin')).not.toBeNull();
    // taps are ignored until the prompt answers
    fireEvent.click(element);
    expect(rec.getUserMedia).toHaveBeenCalledTimes(1);

    await act(async () => rec.grant());
    await settle();
    expect(slot()).toBe(element);
    expect(element).toHaveAttribute('type', 'button');
    expect(element).toHaveAccessibleName('voice-send-sentinel');
    expect(element).not.toHaveAttribute('aria-busy');
    expect(document.activeElement).toBe(element);
  });

  it('keeps the microphone for whitespace and leaves the whitespace in the field', () => {
    const view = mount();
    fireEvent.change(view.field(), { target: { value: '  \n ' } });
    expect(slot()).toHaveAccessibleName('mic-sentinel');
    expect(view.field().value).toBe('  \n ');
    fireEvent.change(view.field(), { target: { value: ' a' } });
    expect(slot()).toHaveAccessibleName('send-sentinel');
    fireEvent.change(view.field(), { target: { value: ' ' } });
    expect(slot()).toHaveAccessibleName('mic-sentinel');
  });

  it('hides the field while recording without unmounting it, and brings it back untouched', async () => {
    const view = mount();
    fireEvent.change(view.field(), { target: { value: '   ' } });
    const field = view.field();
    await record(view);
    expect(view.field()).toBe(field);
    expect(field).toHaveAttribute('hidden');
    expect(field.closest('[class*="hidden"]')).not.toBeNull();
    expect(field.value).toBe('   ');
    act(() => screen.getByRole('button', { name: 'discard-sentinel' }).click());
    expect(field).not.toHaveAttribute('hidden');
    expect(field.value).toBe('   ');
  });

  it('draws the microphone on the server render and withdraws it after mount when the browser cannot record', async () => {
    const html = renderToString(
      <ChatComposer
        label="field-sentinel"
        placeholder="placeholder-sentinel"
        sendLabel="send-sentinel"
        counterTemplate={() => ''}
        errorText="error-sentinel"
        onSend={async () => true}
        voice={voiceBundle()}
      />,
    );
    expect(html).toContain('mic-sentinel');
    expect(html).not.toContain('aria-label="send-sentinel"');

    // No capture API: after mount the slot is today's send, disabled while the field is empty.
    uninstallRecording();
    const view = mount();
    const send = screen.getByRole('button', { name: 'send-sentinel' });
    expect(send).toBe(slot());
    expect(send).toHaveAttribute('type', 'submit');
    expect(send).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'mic-sentinel' })).toBeNull();
    fireEvent.change(view.field(), { target: { value: 'oi' } });
    expect(send).toBeEnabled();
  });

  it('withdraws the microphone with no MediaRecorder or an insecure context', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    mount();
    expect(screen.queryByRole('button', { name: 'mic-sentinel' })).toBeNull();
    cleanup();
    vi.stubGlobal('MediaRecorder', class {});
    vi.stubGlobal('isSecureContext', false);
    mount();
    expect(screen.queryByRole('button', { name: 'mic-sentinel' })).toBeNull();
  });

  it('draws the microphone disabled with opacity-50 when the composer is disabled, never hidden', () => {
    mount(voiceBundle(), { disabled: true });
    const mic = screen.getByRole('button', { name: 'mic-sentinel' });
    expect(mic).toBeDisabled();
    expect(mic.className).toContain('opacity-50');
  });

  it("a host that passes no voice bundle gets no region, no recorder and today's button", () => {
    mount(null);
    expect(status()).toBeNull();
    expect(screen.getByRole('button', { name: 'send-sentinel' })).toBeDisabled();
    expect(rec.getUserMedia).not.toHaveBeenCalled();
  });
});

describe('the recording row (UI-D-843)', () => {
  it('is trash, pill, send in that order, with a pulsing dot and a timer that is never live', async () => {
    const view = mount();
    await record(view);
    const trash = screen.getByRole('button', { name: 'discard-sentinel' });
    const pill = document.querySelector('[data-chat-voice-pill]') as HTMLElement;
    const send = slot();
    const order = (a: Node, b: Node) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(order(trash, pill)).toBeTruthy();
    expect(order(pill, send)).toBeTruthy();
    expect(trash.tabIndex).toBeGreaterThanOrEqual(0);
    expect(send.tabIndex).toBeGreaterThanOrEqual(0);
    expect(view.field()).toHaveAttribute('hidden');
    expect(pill.querySelector('[data-chat-voice-dot]')?.className).toContain(
      'motion-safe:animate-pulse',
    );
    const timer = screen.getByRole('timer', { name: 'timer-sentinel' });
    expect(timer).toHaveAttribute('aria-live', 'off');
    expect(pill).toHaveTextContent('recording-sentinel');
  });

  it('binds no shortcut: Escape and Space change nothing', async () => {
    const view = mount();
    await record(view);
    for (const key of ['Escape', ' ']) {
      fireEvent.keyDown(slot(), { key });
      fireEvent.keyDown(document.body, { key });
    }
    expect(screen.getByRole('timer', { name: 'timer-sentinel' })).toBeInTheDocument();
    expect(rec.track.stop).not.toHaveBeenCalled();
  });

  it('the trash discards at once with no confirmation, and focus lands on the microphone', async () => {
    const view = mount();
    await record(view);
    const trash = screen.getByRole('button', { name: 'discard-sentinel' });
    trash.focus();
    await act(async () => {
      fireEvent.click(trash);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(voiceBundle().onSendVoice).not.toHaveBeenCalled();
    expect(rec.track.stop).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(slot());
    expect(slot()).toHaveAccessibleName('mic-sentinel');
    expect(status()).toHaveTextContent('live-discarded-sentinel');
  });
});

describe('the notice line and the problems (UI-D-842, UI-D-844, UI-D-845)', () => {
  it.each([
    ['NotAllowedError', 'blocked-sentinel'],
    ['SecurityError', 'blocked-sentinel'],
    ['NotFoundError', 'missing-sentinel'],
    ['OverconstrainedError', 'missing-sentinel'],
    ['NotReadableError', 'busy-sentinel'],
    ['AbortError', 'busy-sentinel'],
    ['Error', 'failed-sentinel'],
  ])(
    '%s shows its sentence in neutral ink, leaves the microphone tappable and the field working',
    async (name, sentence) => {
      reinstall({ reject: domError(name) });
      const view = mount();
      await record(view);
      expect(notice()).toHaveTextContent(sentence);
      expect(notice()?.className).toContain('text-text-secondary');
      expect(notice()?.className).not.toContain('text-danger');
      expect(notice()?.getAttribute('role')).toBeNull();
      expect(notice()?.querySelector('svg')).not.toBeNull();
      expect(status()).toHaveTextContent(sentence);
      expect(view.mic()).toBeEnabled();
      expect(view.field()).not.toHaveAttribute('hidden');

      // The next keystroke clears the line.
      fireEvent.change(view.field(), { target: { value: 'a' } });
      expect(notice()).toBeNull();
    },
  );

  it('the next tap on the microphone clears the line', async () => {
    reinstall({ reject: domError('NotAllowedError') });
    const view = mount();
    await record(view);
    expect(notice()).not.toBeNull();
    rec.getUserMedia.mockImplementationOnce(() => new Promise(() => {}));
    await record(view);
    expect(notice()).toBeNull();
  });

  it('shows the 4:30 notice above the row and keeps it to the end without changing the counter colour', async () => {
    const view = mount();
    await record(view);
    advance(269_750);
    expect(notice()).toBeNull();
    advance(250);
    expect(notice()).toHaveTextContent('warning-sentinel');
    const form = document.querySelector('form') as HTMLElement;
    expect(notice()?.compareDocumentPosition(form)).toBeTruthy();
    const timerClass = screen.getByRole('timer').className;
    advance(20_000);
    expect(notice()).toHaveTextContent('warning-sentinel');
    expect(screen.getByRole('timer').className).toBe(timerClass);
  });

  it('the 5:00 stop keeps the three elements, reads the limit word, sends nothing and moves no focus', async () => {
    const onSendVoice = vi.fn(async (_take: VoiceTake) => true);
    const view = mount(voiceBundle({ onSendVoice }));
    await record(view);
    slot().focus();
    advance(300_000);
    const pill = document.querySelector('[data-chat-voice-pill]') as HTMLElement;
    expect(pill).toHaveTextContent('limit-word-sentinel');
    expect(screen.getByRole('timer')).toHaveTextContent('5:00');
    expect(pill.querySelector('[data-chat-voice-dot]')).toBeNull();
    expect(notice()).toHaveTextContent('limit-sentinel');
    expect(screen.getByRole('button', { name: 'discard-sentinel' })).toBeInTheDocument();
    expect(slot()).toHaveAccessibleName('voice-send-sentinel');
    expect(document.activeElement).toBe(slot());
    expect(onSendVoice).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(slot());
    });
    await settle();
    expect(onSendVoice).toHaveBeenCalledTimes(1);
    expect(onSendVoice.mock.calls[0]?.[0]).toMatchObject({ seconds: 300 });
  });

  it('an interruption of 1 second or more reads the interrupted word and sentence', async () => {
    const view = mount();
    await record(view);
    advance(4000);
    act(() => rec.track.end());
    expect(document.querySelector('[data-chat-voice-pill]')).toHaveTextContent(
      'interrupted-word-sentinel',
    );
    expect(notice()).toHaveTextContent('interrupted-sentinel');
    void view;
  });

  it('a tap on send under one second discards with the too-short notice and sends nothing', async () => {
    const onSendVoice = vi.fn(async () => true);
    const view = mount(voiceBundle({ onSendVoice }));
    await record(view);
    advance(500);
    await act(async () => {
      fireEvent.click(slot());
    });
    await settle();
    expect(onSendVoice).not.toHaveBeenCalled();
    expect(notice()).toHaveTextContent('too-short-sentinel');
    expect(slot()).toHaveAccessibleName('mic-sentinel');
    expect(document.activeElement).toBe(slot());
    expect(rec.track.stop).toHaveBeenCalledTimes(1);
  });

  it('an empty take shows the generic problem sentence', async () => {
    const { FakeRecorder } = await import('./voice-fakes');
    FakeRecorder.finalBytes = 0;
    const view = mount();
    await record(view);
    advance(3000);
    await act(async () => {
      fireEvent.click(slot());
    });
    await settle();
    expect(notice()).toHaveTextContent('failed-sentinel');
  });

  it('the shipped send-failure line keeps its alert role while notice lines have none', async () => {
    const view = mount(voiceBundle(), { onSend: vi.fn(async () => false) });
    fireEvent.change(view.field(), { target: { value: 'oi' } });
    await act(async () => {
      fireEvent.click(slot());
    });
    expect(screen.getByRole('alert')).toHaveTextContent('error-sentinel');
    expect(document.querySelectorAll('[data-chat-voice-notice][role]')).toHaveLength(0);
  });
});

describe('the polite status region (UI-D-855, A-UI-17)', () => {
  it('exists from the first render as the only role=status, polite, visually hidden, never assertive', () => {
    mount();
    const regions = screen.getAllByRole('status');
    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveAttribute('aria-live', 'polite');
    expect(regions[0]?.className).toContain('sr-only');
    expect(document.querySelectorAll('[aria-live="assertive"]')).toHaveLength(0);
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });

  it('speaks the start, each full minute to four, the 4:30 and 5:00 sentences, in order', async () => {
    const view = mount();
    await record(view);
    const spoken: string[] = [];
    const watch = () => {
      const text = status().textContent ?? '';
      if (text && spoken[spoken.length - 1] !== text) spoken.push(text);
    };
    watch();
    for (let second = 0; second < 300; second += 1) {
      advance(1000);
      watch();
    }
    expect(spoken).toEqual([
      'live-started-sentinel',
      'live-minute-1-sentinel',
      'live-minute-2-sentinel',
      'live-minute-3-sentinel',
      'live-minute-4-sentinel',
      'warning-sentinel',
      'limit-sentinel',
    ]);
    void view;
  });

  it('speaks the interruption, the too-short and the discard sentences', async () => {
    const view = mount();
    await record(view);
    advance(3000);
    act(() => rec.track.end());
    expect(status()).toHaveTextContent('interrupted-sentinel');
    act(() => screen.getByRole('button', { name: 'discard-sentinel' }).click());
    expect(status()).toHaveTextContent('live-discarded-sentinel');
  });

  it('never makes the elapsed counter live', async () => {
    const view = mount();
    await record(view);
    advance(5000);
    expect(status().textContent).toBe('live-started-sentinel');
    expect(screen.getByRole('timer')).toHaveAttribute('aria-live', 'off');
  });
});

describe('the sizes and the glyphs (UI-D-841, UI-D-843)', () => {
  it('every control is the 44px round button and the pill is a rounded-2xl 44px floor', async () => {
    const view = mount();
    await record(view);
    expect(slot().className).toContain('h-11 w-11');
    expect(screen.getByRole('button', { name: 'discard-sentinel' }).className).toContain(
      'h-11 w-11',
    );
    const pill = document.querySelector('[data-chat-voice-pill]') as HTMLElement;
    expect(pill.className).toContain('min-h-11');
    expect(pill.className).toContain('rounded-2xl');
  });
});
