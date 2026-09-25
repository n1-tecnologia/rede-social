// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import type { CommunitySummary } from '@tria/module-communities/contracts';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 05.1-03 — the `/comunidades` list body under its two statuses (D-87, D-88, UI-D-50, UI-D-51).
 *
 * The catalog is the REAL `communities.json`, so an assertion here fails when the pt-BR copy drifts
 * (the `StoryComposer.test.tsx` pattern). What is stubbed: the two server actions, which a render
 * never calls. What is real: the list's four-state body, the region label, the per-card pill slot and
 * the empty-state split.
 *
 * The four claims worth a test are the four a later edit could quietly break:
 *
 *  1. **UI-D-51.** Zero ARCHIVED communities is its own empty state — named, honest, and with NO
 *     call to action: archiving happens on the edit form, so there is nothing to offer here.
 *  2. **D-87.** Zero ACTIVE communities keeps today's empty state WITH its "Criar comunidade" link,
 *     even though the title row now carries one too. Two routes to one form is accepted.
 *  3. **UI-D-50 / the region.** An archived row carries the neutral "Arquivada" pill, and the region
 *     says it is the archived list of this tenant.
 *  4. **Nothing leaks into Ativas.** An active row carries no pill and the region keeps today's label.
 */

const { catalog } = await vi.hoisted(async () => {
  // `vi.hoisted` runs BEFORE the imports it feeds, so `node:fs` is loaded here rather than above.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return { catalog: read('communities').communities as Record<string, unknown> };
});

// Nothing in the list animates by itself, but `@tria/ui` primitives may; a cancelled spring rejects
// after the run ends under happy-dom (the 05.1-04 lesson).
MotionGlobalConfig.skipAnimations = true;

const lookup = (key: string, values?: Record<string, unknown>) => {
  const raw = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog);
  return String(raw ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values?.[name] ?? ''),
  );
};

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => lookup(key, values),
}));

vi.mock('./actions', () => ({
  loadMoreCommunitiesAction: vi.fn(),
  refreshCommunitiesAction: vi.fn(),
}));

const { CommunitiesList } = await import('./CommunitiesList');

afterEach(cleanup);

const C = catalog as {
  actions: { create: string };
  archived: { pill: string };
  empty: { title: string };
  emptyArchived: { title: string; body: string };
  list: { region: string; regionArchived: string };
};
const TENANT = 'Tenant Demo';

function community(overrides: Partial<CommunitySummary> = {}): CommunitySummary {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Avisos',
    slug: 'avisos',
    description: '',
    // Cover-less, so no media request is involved.
    coverAssetId: null,
    coverVariantWidths: [],
    postCount: 2,
    status: 'active',
    lastActivityAt: '2026-01-01T00:00:00.000000Z',
    ...overrides,
  };
}

function list(props: {
  status: 'active' | 'archived';
  items?: CommunitySummary[];
  canManage?: boolean;
}) {
  return render(
    <CommunitiesList
      initialItems={props.items ?? []}
      initialCursor={null}
      tenantName={TENANT}
      canManage={props.canManage ?? true}
      status={props.status}
    />,
  );
}

describe('CommunitiesList — the Ativas and Arquivadas bodies (05.1-03)', () => {
  it('1. an EMPTY archived list renders its own empty state, with no create link (UI-D-51)', () => {
    const { container } = list({ status: 'archived' });

    const empty = screen.getByTestId('communities-empty-archived');
    expect(within(empty).getByText(C.emptyArchived.title)).toBeTruthy();
    expect(within(empty).getByText(C.emptyArchived.body)).toBeTruthy();
    // Not the Ativas empty state, and no call to action at all.
    expect(screen.queryByText(C.empty.title)).toBeNull();
    expect(container.querySelector('a[href="/comunidades/nova"]')).toBeNull();
  });

  it('2. an EMPTY active list keeps today’s empty state WITH the create link (D-87)', () => {
    list({ status: 'active' });

    const empty = screen.getByTestId('communities-empty');
    expect(within(empty).getByText(C.empty.title)).toBeTruthy();
    const cta = within(empty).getByRole('link', { name: C.actions.create });
    expect(cta.getAttribute('href')).toBe('/comunidades/nova');
  });

  it('3. an archived row carries the Arquivada pill, and the region names the archived list', () => {
    list({ status: 'archived', items: [community({ status: 'archived' })] });

    const region = screen.getByRole('region', {
      name: C.list.regionArchived.replace('{tenant}', TENANT),
    });
    const card = within(region).getByTestId('community-card');
    expect(within(card).getByText(C.archived.pill)).toBeTruthy();
  });

  it('4. an active row carries NO pill, and the region keeps today’s label', () => {
    list({ status: 'active', items: [community()] });

    expect(
      screen.getByRole('region', { name: C.list.region.replace('{tenant}', TENANT) }),
    ).toBeTruthy();
    expect(screen.getByTestId('community-card')).toBeTruthy();
    expect(screen.queryByText(C.archived.pill)).toBeNull();
  });
});
