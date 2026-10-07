// @vitest-environment happy-dom
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { GATE_SKIP_KEY } from '@/lib/install-gate';
import { InstallGate } from './InstallGate';

/**
 * The install gate as a rendered component (quick 261007-kyp): the real pt-BR catalog, a stubbed
 * device (user agent, touch points, display mode) and a stubbed pathname. The pure decision has its
 * own test (lib/install-gate.test.ts); this one pins what the component does with it: what renders,
 * what does not mount, the escape hatch, the Android prompt and the first-HTML contract.
 */

let pathname = '/entrar';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const UA = {
  iphoneSafari17:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  iphoneSafari16_3:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1',
  iphoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.29.110 (iPhone14,5; iOS 17_0; pt_BR; pt-BR; scale=3.00; 1170x2532; 500000000)',
  ipadosMac17:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// happy-dom replaces `URL`, so the catalog is resolved from the package root (vitest's cwd).
const messages = loadMessages(path.resolve(process.cwd(), 'messages/pt-BR'));

const Provider = NextIntlClientProvider as unknown as (props: {
  locale: string;
  messages: unknown;
  timeZone: string;
  children?: ReactNode;
}) => ReactNode;

function setDevice(userAgent: string, maxTouchPoints = 0, standalone = false) {
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    value: maxTouchPoints,
    configurable: true,
  });
  Object.defineProperty(window.navigator, 'standalone', { value: undefined, configurable: true });
  window.matchMedia = ((query: string) => ({
    matches: standalone && query.includes('standalone'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const BRAND = { displayName: 'Rede Demo', logoUrl: null };

function gate(over: { enabled?: boolean } = {}) {
  return (
    <Provider locale="pt-BR" messages={messages} timeZone="America/Sao_Paulo">
      <InstallGate
        enabled={over.enabled ?? true}
        brand={BRAND}
        brandStyle={{}}
        brandAttributes={{}}
      >
        <p>app-child</p>
      </InstallGate>
    </Provider>
  );
}

async function mount(over: { enabled?: boolean } = {}) {
  const view = render(gate(over));
  await act(async () => {});
  return view;
}

const gateMessages = (messages as { pwa: { gate: Record<string, unknown> } }).pwa.gate;
const TITLE = String(gateMessages.title);
const CONTINUE = String(gateMessages.continue);

beforeEach(() => {
  pathname = '/entrar';
  delete document.documentElement.dataset.installGate;
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe('InstallGate: what renders', () => {
  it('1. disabled: the child renders and html carries no data-install-gate', async () => {
    setDevice(UA.iphoneSafari17, 5);
    await mount({ enabled: false });
    expect(screen.getByText('app-child')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull();
    expect(document.documentElement.dataset.installGate).toBeUndefined();
  });

  it('2. iPhone Safari outside standalone: title, tenant lead, three iOS steps, no child, no escape', async () => {
    setDevice(UA.iphoneSafari17, 5);
    await mount();
    expect(screen.getByRole('heading', { name: TITLE })).toBeTruthy();
    expect(
      screen.getByText(String(gateMessages.lead).replace('{tenant}', 'Rede Demo')),
    ).toBeTruthy();
    const steps = screen.getByRole('list', {
      name: String((gateMessages.ios as { stepsLabel: string }).stepsLabel),
    });
    expect(steps.querySelectorAll('li')).toHaveLength(3);
    expect(steps.textContent).toContain('Compartilhar');
    expect(steps.textContent).toContain('Adicionar à Tela de Início');
    expect(screen.queryByRole('button', { name: CONTINUE })).toBeNull();
    expect(screen.queryByText('app-child')).toBeNull();
    expect(document.documentElement.dataset.installGate).toBe('gated');
  });

  it('3. iPadOS (Macintosh user agent with touch) gets the same iOS gate', async () => {
    setDevice(UA.ipadosMac17, 5);
    await mount();
    expect(screen.getByRole('heading', { name: TITLE })).toBeTruthy();
    expect(
      screen.getByRole('list', {
        name: String((gateMessages.ios as { stepsLabel: string }).stepsLabel),
      }),
    ).toBeTruthy();
    expect(screen.queryByText('app-child')).toBeNull();
  });

  it('4. standalone iPhone renders the child and html is open', async () => {
    setDevice(UA.iphoneSafari17, 5, true);
    await mount();
    expect(screen.getByText('app-child')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull();
    expect(document.documentElement.dataset.installGate).toBe('open');
  });

  it('5. a desktop user agent renders the child', async () => {
    setDevice(UA.windowsChrome, 0);
    await mount();
    expect(screen.getByText('app-child')).toBeTruthy();
    expect(document.documentElement.dataset.installGate).toBe('open');
  });
});

describe('InstallGate: the escape hatch', () => {
  it('6. iOS 16.3 shows Continuar no navegador; clicking opens the app and a fresh render keeps it open', async () => {
    setDevice(UA.iphoneSafari16_3, 5);
    await mount();
    expect(screen.getByRole('heading', { name: TITLE })).toBeTruthy();
    expect(screen.getByText(String((gateMessages.ios as { old: string }).old))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: CONTINUE }));
    expect(screen.getByText('app-child')).toBeTruthy();
    expect(window.sessionStorage.getItem(GATE_SKIP_KEY)).not.toBeNull();
    cleanup();

    await mount();
    expect(screen.getByText('app-child')).toBeTruthy();
  });

  it('7. the Instagram in-app browser shows the in-app screen with the escape; clicking opens the app', async () => {
    setDevice(UA.iphoneInstagram, 5);
    await mount();
    const inApp = gateMessages.inApp as { title: string };
    expect(screen.getByRole('heading', { name: inApp.title })).toBeTruthy();
    expect(screen.queryByText('app-child')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: CONTINUE }));
    expect(screen.getByText('app-child')).toBeTruthy();
  });

  it('10. a stale skip flag never opens the gate for Safari 17 or Android Chrome', async () => {
    window.sessionStorage.setItem(GATE_SKIP_KEY, '1');

    setDevice(UA.iphoneSafari17, 5);
    await mount();
    expect(screen.getByRole('heading', { name: TITLE })).toBeTruthy();
    expect(screen.queryByText('app-child')).toBeNull();
    cleanup();

    setDevice(UA.androidChrome, 5);
    await mount();
    expect(screen.getByRole('heading', { name: TITLE })).toBeTruthy();
    expect(screen.queryByText('app-child')).toBeNull();
    expect(screen.queryByRole('button', { name: CONTINUE })).toBeNull();
  });
});

describe('InstallGate: first HTML', () => {
  it('11. the server render of the enabled gate is the app, not the gate (hydration agrees)', () => {
    setDevice(UA.iphoneSafari17, 5);
    const html = renderToString(gate());
    expect(html).toContain('app-child');
    expect(html).not.toContain(TITLE);
  });
});

describe('InstallGate: Android prompt', () => {
  it('8. Android Chrome with no captured prompt shows the manual steps, no Instalar app, no escape', async () => {
    setDevice(UA.androidChrome, 5);
    await mount();
    const android = gateMessages.android as { stepsLabel: string };
    expect(screen.getByRole('heading', { name: TITLE })).toBeTruthy();
    expect(screen.getByRole('list', { name: android.stepsLabel })).toBeTruthy();
    expect(screen.queryByRole('button', { name: String(gateMessages.install) })).toBeNull();
    expect(screen.queryByRole('button', { name: CONTINUE })).toBeNull();
    expect(screen.queryByText('app-child')).toBeNull();
  });

  // Last in the file: the captured prompt and the installed state live in module state.
  it('9. after beforeinstallprompt the Instalar app button calls prompt once; appinstalled shows App instalado', async () => {
    setDevice(UA.androidChrome, 5);
    await mount();
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: ReturnType<typeof vi.fn>;
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
    };
    event.prompt = vi.fn(async () => {});
    event.userChoice = Promise.resolve({ outcome: 'dismissed' });
    await act(async () => {
      window.dispatchEvent(event);
    });
    const button = screen.getByRole('button', { name: String(gateMessages.install) });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(event.prompt).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    const installed = gateMessages.installed as { title: string };
    expect(screen.getByRole('status').textContent).toContain(installed.title);
  });
});
