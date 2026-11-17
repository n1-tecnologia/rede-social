// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatComposer, type ChatComposerVoice } from '../ui/index';
import { fakeClock, installRecording, uninstallRecording, voiceBundle } from './voice-fakes';

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

function mount(
  voice: ChatComposerVoice | undefined = voiceBundle(),
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
      voice={voice}
    />,
  );
  return {
    ...view,
    field: () =>
      screen.getByRole('textbox', { name: 'field-sentinel', hidden: true }) as HTMLTextAreaElement,
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
