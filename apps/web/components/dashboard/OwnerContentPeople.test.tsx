// @vitest-environment happy-dom
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ContentPerson,
  ownerContentInteractors,
} from '@rede-social/module-dashboard/fixtures';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { DashboardT } from './format';
import { PeopleCards } from './OwnerContentPeople';

/**
 * The people lists of Conteúdo and Financeiro (quick 261014-ia8 C-2/F-2) on the REAL pt-BR catalog:
 * "e mais N" only ever follows at least one card; a list with nobody in the sample says so.
 */

afterEach(cleanup);

// A path join, not `new URL(…, import.meta.url)`: happy-dom replaces the global URL.
const catalogDir = join(dirname(fileURLToPath(import.meta.url)), '../../messages/pt-BR/');
const messages = loadMessages(catalogDir) as Record<string, unknown>;
const { createTranslator } = await import('next-intl');
const t = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'dashboard',
  // any: the untyped test translator stands in for the app's typed DashboardT (BandMembers.test).
} as never) as unknown as DashboardT;

function renderCards(
  people: readonly ContentPerson[],
  total: number,
  emptyText?: string,
  wide?: boolean,
) {
  const { container } = render(
    <PeopleCards
      t={t}
      people={people}
      total={total}
      hrefOf={(memberId) => `/membro/${memberId}`}
      leadOf={() => 'lead-sentinel'}
      showBand
      moreText={(more) => t('tenantOwner.bandMembers.more', { count: more })}
      emptyText={emptyText}
      wide={wide}
    />,
  );
  return container;
}

function texts(root: Element): string[] {
  return [...root.querySelectorAll('p')].map((el) => el.textContent?.trim() ?? '');
}

describe('PeopleCards (quick 261014-ia8 C-2/F-2)', () => {
  it('with nobody in the sample says so, with no cards, no "e mais" and no "Ver todos"', () => {
    const container = renderCards([], 6);
    expect(texts(container)).toContain('Nenhum destes membros está na amostra.');
    expect(container.querySelectorAll('ul')).toHaveLength(0);
    expect(texts(container).some((text) => text.startsWith('e mais'))).toBe(false);
    expect(container.textContent).not.toContain('Ver todos');
  });

  it('says the caller’s empty sentence when it has one', () => {
    const container = renderCards([], 6, 'empty-sentinel');
    expect(texts(container)).toContain('empty-sentinel');
    expect(container.textContent).not.toContain('Nenhum destes membros está na amostra.');
    expect(container.querySelectorAll('ul')).toHaveLength(0);
  });

  it('lists the sample first, then how many more', () => {
    const people = ownerContentInteractors(null).people.slice(0, 2);
    expect(people).toHaveLength(2);
    const container = renderCards(people, 6);
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
    expect(texts(container)).toContain('e mais 4 membros');
    expect(container.textContent).toContain('Ver todos');
  });

  it('draws no note and no example tag, and the cards rise one after the other', () => {
    const people = ownerContentInteractors(null).people.slice(0, 2);
    const container = renderCards(people, 6);
    expect(container.textContent).not.toContain('Mostrando quem está na amostra');
    expect(container.textContent).not.toContain('exemplo');
    expect(container.querySelector('ul[data-dash-stagger]')).not.toBeNull();
  });

  it('stacks the cards unless the list spans the whole area', () => {
    const people = ownerContentInteractors(null).people.slice(0, 2);
    const stacked = renderCards(people, 2);
    expect(stacked.querySelector('ul')?.className).not.toContain('grid-cols-2');
    cleanup();
    const wide = renderCards(people, 2, undefined, true);
    expect(wide.querySelector('ul')?.className).toContain('@4xl:grid-cols-2');
  });
});
