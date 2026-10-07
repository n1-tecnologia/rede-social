// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The early `beforeinstallprompt` capture (quick 261007-kyp). Module state is per page load, so
 * every case resets the module registry and imports a fresh copy.
 */

type FakeInstallEvent = Event & {
  prompt: ReturnType<typeof vi.fn>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function installEvent(outcome: 'accepted' | 'dismissed'): FakeInstallEvent {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as FakeInstallEvent;
  event.prompt = vi.fn(async () => {});
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

async function fresh() {
  vi.resetModules();
  return import('./install-prompt');
}

describe('install-prompt', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('1. with no event the state is none and promptInstall answers unavailable', async () => {
    const mod = await fresh();
    expect(mod.getInstallPromptState()).toBe('none');
    expect(await mod.promptInstall()).toBe('unavailable');
  });

  it('2. an event captured at import time (before any call) is default-prevented and available', async () => {
    const mod = await fresh();
    const event = installEvent('accepted');
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(mod.getInstallPromptState()).toBe('available');
  });

  it('3. promptInstall calls prompt once and answers the outcome; accepted -> installed', async () => {
    const mod = await fresh();
    const event = installEvent('accepted');
    window.dispatchEvent(event);
    const answer = await mod.promptInstall();
    expect(answer).toBe('accepted');
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(mod.getInstallPromptState()).toBe('installed');
  });

  it('4. the event is single use: dismissed leaves none and a second call is unavailable', async () => {
    const mod = await fresh();
    const event = installEvent('dismissed');
    window.dispatchEvent(event);
    expect(await mod.promptInstall()).toBe('dismissed');
    expect(mod.getInstallPromptState()).toBe('none');
    expect(await mod.promptInstall()).toBe('unavailable');
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it('5. appinstalled moves the state to installed and drops the event', async () => {
    const mod = await fresh();
    window.dispatchEvent(installEvent('accepted'));
    window.dispatchEvent(new Event('appinstalled'));
    expect(mod.getInstallPromptState()).toBe('installed');
    expect(await mod.promptInstall()).toBe('unavailable');
  });

  it('6. subscribers hear every change and unsubscribe', async () => {
    const mod = await fresh();
    const listener = vi.fn();
    const off = mod.subscribeInstallPrompt(listener);
    window.dispatchEvent(installEvent('accepted'));
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('appinstalled'));
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    window.dispatchEvent(installEvent('accepted'));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
