import type { Bootstrap } from '@rede-social/contracts';
import type { NavItem } from '@rede-social/core/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectTabDots, eventsTabDot, type TabDotLoader } from './tab-dots';

/**
 * 2026-10-03 — the shell's tab dots: the Eventos loader (the dot while an event is to come, the
 * product decision that replaced the Início "Próximo evento" card) and the collector the `(app)`
 * layout reads them through. The catalog is the REAL `events.json`, so a copy drift fails here.
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  // Vitest runs from `apps/web` (the `EventsList.test.tsx` precedent).
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

const next = vi.hoisted(() => ({ event: null as { endsAt: string } | null }));

vi.mock('@/lib/events', () => ({ loadNextEvent: vi.fn(async () => next.event) }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace }),
  };
});

const bootstrap = { tenant: { id: 't-1' } } as unknown as Bootstrap;
const tab = (key: string, label: string): NavItem => ({
  key,
  label,
  href: `/${key}`,
  icon: 'home',
});
const TABS = [tab('home', 'Início'), tab('events', 'Eventos'), tab('profile', 'Perfil')];

beforeEach(() => {
  next.event = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('eventsTabDot (the next event, as the Início card read it)', () => {
  it('an event to come: the catalog description, refreshed at its end', async () => {
    next.event = { endsAt: '2026-10-03T23:00:00.000Z' };
    await expect(eventsTabDot({ bootstrap })).resolves.toEqual({
      description: 'Há eventos por vir',
      until: '2026-10-03T23:00:00.000Z',
    });
  });

  it('nothing to come (or a failed read, which loadNextEvent answers as null): no dot', async () => {
    await expect(eventsTabDot({ bootstrap })).resolves.toBeNull();
  });
});

describe('collectTabDots (the layout reads every tab dot through it)', () => {
  it('asks only the tabs with a loader, all at once, with the bootstrap, keyed by tab', async () => {
    const started: string[] = [];
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loader =
      (key: string): TabDotLoader =>
      async (ctx) => {
        started.push(key);
        expect(ctx.bootstrap).toBe(bootstrap);
        await gate;
        return { description: `${key}-desc`, until: null };
      };
    const loaders: Record<string, TabDotLoader> = {
      events: loader('events'),
      profile: loader('profile'),
    };
    const pending = collectTabDots((key) => loaders[key], bootstrap, TABS);
    // Both were asked before either answered: concurrent, not one after the other.
    await vi.waitFor(() => expect(started.sort()).toEqual(['events', 'profile']));
    release();
    await expect(pending).resolves.toEqual({
      events: { description: 'events-desc', until: null },
      profile: { description: 'profile-desc', until: null },
    });
  });

  it('a loader answering null leaves its tab without a dot', async () => {
    await expect(collectTabDots(() => async () => null, bootstrap, TABS)).resolves.toEqual({});
  });

  it('a loader that rejects costs only its own dot, logged with the tab key', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const loaders: Record<string, TabDotLoader> = {
      events: async () => {
        throw new Error('boom');
      },
      profile: async () => ({ description: 'ok', until: null }),
    };
    await expect(collectTabDots((key) => loaders[key], bootstrap, TABS)).resolves.toEqual({
      profile: { description: 'ok', until: null },
    });
    expect(error).toHaveBeenCalledWith('tab-dot.failed', { tab: 'events', reason: 'Error: boom' });
  });

  it('a row with no loader asks nothing', async () => {
    const loaderFor = vi.fn((_key: string): TabDotLoader | undefined => undefined);
    await expect(collectTabDots(loaderFor, bootstrap, TABS)).resolves.toEqual({});
    expect(loaderFor.mock.calls.map(([key]) => key)).toEqual(['home', 'events', 'profile']);
  });
});
