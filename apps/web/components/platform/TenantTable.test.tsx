// @vitest-environment happy-dom
import { DATABASE_STATES, type DatabaseState } from '@rede-social/contracts/projects';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TenantRowView } from '@/lib/platform';

/**
 * 09.2-20 Task 1 (UI-D-540, DBT-52, E07) - the Banco column of the tenant list. The claims are on the
 * rendered table and cards: the sixth column sits between Status and Criado em with the shared pill,
 * the schema line follows the omission rule, the widths are 24 / 22 / 12 / 12 / 18 / 12, the mobile
 * card always carries the pill, the chip-specific empty replaces the generic one under `?banco`, and
 * the component never reorders what the API sent. Class assertions only: the 320 px measurement is
 * the plan 28 browser spec's (sketch finding F-6).
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({
        locale: 'pt-BR',
        messages: harness.messages,
        namespace,
        onError: (error) => {
          throw error;
        },
      }),
  };
});

const { TenantTable, TenantTableSkeleton } = await import('./TenantTable');

afterEach(cleanup);

const LABELS = {
  colTenant: 'Tenant',
  colPrimaryHost: 'Domínio primário',
  colModules: 'Módulos',
  colStatus: 'Status',
  colDatabase: 'Banco',
  colCreatedAt: 'Criado em',
  noHost: 'Sem domínio',
  active: 'Ativo',
  suspended: 'Suspenso',
  loadMore: 'Carregar mais',
  loadingMore: 'Carregando…',
  emptyTitle: 'Nenhum tenant ainda',
  emptyBody: 'Crie o primeiro tenant para começar.',
  searchEmptyTitle: 'Nenhum tenant encontrado',
  searchEmptyBody: 'Tente outro nome ou slug.',
  databaseEmptyTitle: 'Nenhum tenant com problema no banco',
  databaseEmptyBody: 'Todos os bancos estão prontos ou em andamento.',
  new: 'Novo tenant',
};

function row(
  id: string,
  state: DatabaseState | null,
  schema: { applied: number | null; required: number | null } = { applied: 147, required: 147 },
  over: Partial<TenantRowView> = {},
): TenantRowView {
  return {
    id,
    slug: `slug-${id}`,
    displayName: `Tenant ${id}`,
    status: 'active',
    primaryHost: `${id}.exemplo.com.br`,
    modulesCount: 3,
    modulesLabel: '3 módulos',
    createdAtLabel: '12/10/2026',
    ...(state ? { database: { state, schema } } : {}),
    ...over,
  };
}

function renderTable(rows: TenantRowView[], query = { limit: 25 } as Record<string, unknown>) {
  return render(
    <TenantTable
      rows={rows}
      nextCursor={null}
      query={query as { limit: number }}
      labels={LABELS}
    />,
  );
}

const WORDS: Record<DatabaseState, string> = {
  ready: 'Pronto',
  preparing: 'Em preparação',
  preparation_failed: 'Preparação falhou',
  behind: 'Atrasado',
  paused: 'Pausado',
  unreachable: 'Inacessível',
  moving: 'Em mudança',
  unchecked: 'Não verificado',
};

const desktop = (container: HTMLElement) => container.querySelector('table') as HTMLElement;
const mobile = (container: HTMLElement) => container.querySelector('ul') as HTMLElement;

describe('TenantTable - the Banco column (UI-D-540)', () => {
  it('adds a sixth header "Banco" between Status and Criado em', () => {
    const { container } = renderTable([row('a', 'ready')]);
    const headers = within(desktop(container))
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(headers).toEqual([
      'Tenant',
      'Domínio primário',
      'Módulos',
      'Status',
      'Banco',
      'Criado em',
    ]);
  });

  it('sets the column widths to 24 / 22 / 12 / 12 / 18 / 12 and keeps the header style', () => {
    const { container } = renderTable([row('a', 'ready')]);
    const headers = within(desktop(container)).getAllByRole('columnheader');
    const widths = headers.map((th) => /w-\[(\d+)%\]/.exec(th.className)?.[1]);
    expect(widths).toEqual(['24', '22', '12', '12', '18', '12']);
    for (const th of headers) {
      expect(th.className).toContain('text-xs');
      expect(th.className).toContain('font-bold');
      expect(th.className).toContain('uppercase');
      expect(th.className).toContain('tracking-wider');
    }
  });

  it.each(DATABASE_STATES)('shows the %s pill in the table row and in the mobile card', (state) => {
    const { container } = renderTable([row('a', state)]);
    expect(within(desktop(container)).getByTestId('database-pill').textContent).toBe(WORDS[state]);
    expect(within(mobile(container)).getByTestId('database-pill').textContent).toBe(WORDS[state]);
  });

  it('prints "Esquema 147" under a ready pill and keeps the tertiary tabular 12/400 line', () => {
    const { container } = renderTable([row('a', 'ready', { applied: 147, required: 147 })]);
    const line = within(desktop(container)).getByTestId('schema-line');
    expect(line.textContent).toBe('Esquema 147');
    expect(line.className).toContain('mt-1');
    expect(line.className).toContain('text-xs');
    expect(line.className).toContain('font-normal');
    expect(line.className).toContain('tabular-nums');
    expect(line.className).toContain('text-text-tertiary');
  });

  it('prints "Esquema 144 de 147" for an Atrasado tenant', () => {
    const { container } = renderTable([row('a', 'behind', { applied: 144, required: 147 })]);
    expect(within(desktop(container)).getByTestId('schema-line').textContent).toBe(
      'Esquema 144 de 147',
    );
  });

  it.each(['preparing', 'preparation_failed', 'moving'] as const)(
    'omits the schema line for %s even when counts exist',
    (state) => {
      const { container } = renderTable([row('a', state, { applied: 12, required: 147 })]);
      expect(within(desktop(container)).queryByTestId('schema-line')).toBeNull();
      expect(within(desktop(container)).getByTestId('database-pill')).not.toBeNull();
    },
  );

  it.each(['paused', 'unreachable', 'unchecked'] as const)(
    'keeps the schema line for %s when the counts are known',
    (state) => {
      const { container } = renderTable([row('a', state, { applied: 147, required: 147 })]);
      expect(within(desktop(container)).getByTestId('schema-line').textContent).toBe('Esquema 147');
    },
  );

  it('leaves the line out when the applied count is unknown instead of inventing one', () => {
    const { container } = renderTable([row('a', 'unreachable', { applied: null, required: 147 })]);
    expect(within(desktop(container)).queryByTestId('schema-line')).toBeNull();
  });

  it('never shows the schema line on the mobile card (the pill is the parity item)', () => {
    const { container } = renderTable([row('a', 'behind', { applied: 144, required: 147 })]);
    expect(within(mobile(container)).queryByTestId('schema-line')).toBeNull();
  });

  it('renders "Não verificado" for a row with no database fact (P103), never nothing', () => {
    const { container } = renderTable([row('a', null)]);
    expect(within(desktop(container)).getByTestId('database-pill').textContent).toBe(
      'Não verificado',
    );
    expect(within(mobile(container)).getByTestId('database-pill').textContent).toBe(
      'Não verificado',
    );
  });

  it('puts the mobile pills line after the slug and host line with mt-1 flex flex-wrap gap-1', () => {
    const { container } = renderTable([row('a', 'preparation_failed')]);
    const pill = within(mobile(container)).getByTestId('database-pill');
    const line = pill.parentElement as HTMLElement;
    expect(line.className).toContain('mt-1');
    expect(line.className).toContain('flex');
    expect(line.className).toContain('flex-wrap');
    expect(line.className).toContain('gap-1');
    const slugLine = within(mobile(container)).getByTitle('slug-a').parentElement as HTMLElement;
    expect(slugLine.nextElementSibling).toBe(line);
  });

  it('keeps the stretched row link by id, the truncation with title and the other cells', () => {
    const { container } = renderTable([row('abc', 'ready')]);
    const link = within(desktop(container)).getByRole('link', { name: 'Tenant abc (slug-abc)' });
    expect(link.getAttribute('href')).toBe('/plataforma/tenants/abc');
    expect(link.className).toContain('after:absolute');
    expect(within(desktop(container)).getByTitle('Tenant abc').className).toContain('truncate');
    expect(within(desktop(container)).getByTitle('abc.exemplo.com.br').className).toContain(
      'truncate',
    );
    expect(within(desktop(container)).getByText('3 módulos')).not.toBeNull();
    expect(within(desktop(container)).getByText('12/10/2026')).not.toBeNull();
  });

  it('keeps a long name with the Preparação falhou pill inside its box (min-w-0, truncate, line-clamp)', () => {
    const name = 'Associação Brasileira de Mentoras e Mentores de Carreira e Negócios do Sul';
    const { container } = renderTable([
      row('a', 'preparation_failed', undefined, { displayName: name }),
    ]);
    const cell = within(desktop(container)).getByTitle(name);
    expect(cell.className).toContain('truncate');
    expect((cell.closest('a') as HTMLElement).className).toContain('min-w-0');
    const card = within(mobile(container)).getByRole('link', { name: `${name} (slug-a)` });
    expect(card.className).toContain('line-clamp-2');
    expect(card.className).toContain('min-w-0');
    expect(within(desktop(container)).getByTestId('database-pill').textContent).toBe(
      'Preparação falhou',
    );
    expect(desktop(container).className).toContain('table-fixed');
  });

  it('renders the rows in the order the API sent whatever the pills say (P102)', () => {
    const rows = [
      row('c', 'ready'),
      row('b', 'unreachable'),
      row('a', 'preparation_failed'),
      row('d', 'unchecked'),
    ];
    const { container } = renderTable(rows);
    const names = within(desktop(container))
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(names).toEqual([
      '/plataforma/tenants/c',
      '/plataforma/tenants/b',
      '/plataforma/tenants/a',
      '/plataforma/tenants/d',
    ]);
    const cards = within(mobile(container))
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(cards).toEqual(names);
  });

  it('uses the same row geometry for one row and for many', () => {
    const one = renderTable([row('a', 'ready')]);
    const oneClass = (desktop(one.container).querySelector('tbody tr') as HTMLElement).className;
    cleanup();
    const many = renderTable([row('a', 'ready'), row('b', 'behind'), row('c', 'paused')]);
    const rows = desktop(many.container).querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    for (const tr of Array.from(rows)) expect(tr.className).toBe(oneClass);
  });
});

describe('TenantTable - empty states (E07)', () => {
  it('shows the chip-specific empty under ?banco=problema, not the generic one', () => {
    renderTable([], { banco: 'problema', limit: 25 });
    expect(screen.getByText('Nenhum tenant com problema no banco')).not.toBeNull();
    expect(screen.getByText('Todos os bancos estão prontos ou em andamento.')).not.toBeNull();
    expect(screen.queryByText('Nenhum tenant encontrado')).toBeNull();
    expect(screen.queryByText('Nenhum tenant ainda')).toBeNull();
  });

  it('keeps the generic search empty for ?status and the first-run empty for no filter', () => {
    renderTable([], { status: 'suspended', limit: 25 });
    expect(screen.getByText('Nenhum tenant encontrado')).not.toBeNull();
    expect(screen.queryByText('Nenhum tenant com problema no banco')).toBeNull();
    cleanup();
    renderTable([]);
    expect(screen.getByText('Nenhum tenant ainda')).not.toBeNull();
    expect(screen.getByRole('link', { name: /Novo tenant/ })).not.toBeNull();
  });
});

describe('TenantTableSkeleton (E07 loading)', () => {
  it('gains one rounded-full 10% cell per placeholder row and keeps five rows', () => {
    const { container } = render(<TenantTableSkeleton />);
    const rows = Array.from(container.querySelectorAll('div.min-h-14.items-center.gap-4'));
    expect(rows).toHaveLength(5);
    for (const placeholder of rows) {
      const pills = Array.from(placeholder.children).filter((child) =>
        child.className.includes('rounded-full'),
      );
      expect(pills).toHaveLength(2);
    }
  });
});

/**
 * 09.4-16 Task 3 (UI-D-560, CTK-41; E08) - the "Token: {state}" pill of the list. It sits under the Banco
 * pill and schema line of the desktop cell (`mt-1`) and in the mobile card's pills line, ONLY for a row whose
 * `database.token.state` needs attention. Platform rows, Válido and Não verificado rows show none; the pill
 * text is fixed catalog text, and the tenant name and slug still truncate.
 */
describe('TenantTable - the token pill (UI-D-560)', () => {
  const schema = { applied: 147, required: 147 };
  const withToken = (id: string, token: string | null, state: DatabaseState = 'ready') =>
    row(id, state, schema, {
      database: { state, schema, ...(token ? { token: { state: token as never } } : {}) },
    });

  it.each([
    ['expiring', 'Token: Vencendo'],
    ['expired', 'Token: Vencido'],
    ['invalid', 'Token: Inválido'],
    ['no_permission', 'Token: Sem permissão'],
    ['org_mismatch', 'Token: Organização diferente'],
  ])('shows "%s" as "%s" in the table cell and in the mobile card', (token, text) => {
    const { container } = renderTable([withToken('a', token)]);
    expect(within(desktop(container)).getByTestId('row-token-pill').textContent).toBe(text);
    expect(within(mobile(container)).getByTestId('row-token-pill').textContent).toBe(text);
  });

  it('places the pill under the Banco pill and the schema line, with mt-1', () => {
    const { container } = renderTable([withToken('a', 'expiring')]);
    const cell = within(desktop(container))
      .getByTestId('database-pill')
      .closest('td') as HTMLElement;
    const pill = within(cell).getByTestId('row-token-pill');
    const line = within(cell).getByTestId('schema-line');
    expect(line.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((pill.parentElement as HTMLElement).className).toContain('mt-1');
  });

  it('puts the pill in the mobile card pills line, beside the Banco pill', () => {
    const { container } = renderTable([withToken('a', 'expired', 'behind')]);
    const line = within(mobile(container)).getByTestId('database-pill')
      .parentElement as HTMLElement;
    expect(line.className).toContain('flex-wrap');
    expect(line.className).toContain('gap-1');
    expect(within(line).getByTestId('row-token-pill').textContent).toBe('Token: Vencido');
  });

  it.each([
    ['valid', 'a Válido row'],
    ['unchecked', 'a Não verificado row'],
    [null, 'a platform row (no token)'],
  ])('shows no token pill for %s: %s (E08 partial)', (token) => {
    const { container } = renderTable([withToken('a', token)]);
    expect(within(desktop(container)).queryByTestId('row-token-pill')).toBeNull();
    expect(within(mobile(container)).queryByTestId('row-token-pill')).toBeNull();
  });

  it('shows no token pill for a row whose database fact is absent', () => {
    const { container } = renderTable([row('a', null)]);
    expect(container.querySelector('[data-testid="row-token-pill"]')).toBeNull();
  });

  it('shows the pill only on the rows that need it, in the same row geometry (zero, one, many)', () => {
    const zero = renderTable([withToken('a', 'valid'), withToken('b', null)]);
    expect(zero.container.querySelectorAll('[data-testid="row-token-pill"]')).toHaveLength(0);
    cleanup();
    const many = renderTable([
      withToken('a', 'expiring'),
      withToken('b', 'valid'),
      withToken('c', 'invalid'),
      withToken('d', 'org_mismatch', 'unreachable'),
    ]);
    const trs = Array.from(desktop(many.container).querySelectorAll('tbody tr'));
    expect(trs).toHaveLength(4);
    expect(trs.map((tr) => tr.querySelectorAll('[data-testid="row-token-pill"]').length)).toEqual([
      1, 0, 1, 1,
    ]);
    expect(new Set(trs.map((tr) => tr.className)).size).toBe(1);
  });

  it('keeps the name and the slug truncating with title beside the pill (E08 long-text)', () => {
    const name = 'Associação Brasileira de Mentoras e Mentores de Carreira e Negócios do Sul';
    const { container } = renderTable([
      row('a', 'ready', schema, {
        displayName: name,
        slug: 'a-very-long-slug-for-a-tenant-that-keeps-going',
        database: { state: 'ready', schema, token: { state: 'org_mismatch' } },
      }),
    ]);
    expect(within(desktop(container)).getByTitle(name).className).toContain('truncate');
    expect(
      within(desktop(container)).getByTitle('a-very-long-slug-for-a-tenant-that-keeps-going')
        .className,
    ).toContain('truncate');
    expect(within(desktop(container)).getByTestId('row-token-pill').textContent).toBe(
      'Token: Organização diferente',
    );
    const card = within(mobile(container)).getByRole('link', {
      name: `${name} (a-very-long-slug-for-a-tenant-that-keeps-going)`,
    });
    expect(card.className).toContain('line-clamp-2');
  });
});
