// @vitest-environment happy-dom
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownerBandRoster, ownerMemberInsights } from '@rede-social/module-dashboard/fixtures';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { OwnerMemberListSlug } from '@/lib/owner-band-scope';
import type { DashboardT } from './format';
import { OwnerMemberList } from './OwnerMemberList';

/**
 * The level-4 member lists (quick 261013-orf D-01) on the REAL pt-BR catalog: every row of a
 * publication list starts with the publication's decorative thumbnail, a check-in with the event's
 * and an order with the product's; the active days have none.
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

function renderList(memberId: string, list: OwnerMemberListSlug) {
  const { container } = render(
    <OwnerMemberList t={t} memberId={memberId} list={list} backHref="/voltar" />,
  );
  return {
    rows: container.querySelectorAll('li'),
    thumbs: container.querySelectorAll<HTMLElement>('[data-testid="cover-thumb"]'),
  };
}

function insightsOf(id: string) {
  const insights = ownerMemberInsights(id);
  if (!insights) throw new Error(`no insights for ${id}`);
  return insights;
}

describe('OwnerMemberList thumbnails (quick 261013-orf D-01)', () => {
  const { lists, last30 } = insightsOf('om-13');

  it('gives every row of the publication lists one decorative thumbnail', () => {
    const lengths: [OwnerMemberListSlug, number][] = [
      ['curtidas', lists.likes.length],
      ['comentarios', lists.comments.length],
      ['posts-vistos', lists.postsSeen.value.length],
      ['acoes-fortes', lists.strongActions.length],
    ];
    for (const [slug, length] of lengths) {
      const { rows, thumbs } = renderList('om-13', slug);
      expect(length, slug).toBeGreaterThan(0);
      expect(rows, slug).toHaveLength(length);
      expect(thumbs, slug).toHaveLength(length);
      for (const row of rows) {
        expect(row.querySelectorAll('[data-testid="cover-thumb"]'), slug).toHaveLength(1);
      }
      for (const thumb of thumbs) expect(thumb.getAttribute('aria-hidden'), slug).toBe('true');
      cleanup();
    }
  });

  it('marks the check-ins as events and leaves the active days without thumbnails', () => {
    const strong = renderList('om-13', 'acoes-fortes');
    expect(last30.checkIns).toBe(4);
    expect([...strong.thumbs].filter((thumb) => thumb.dataset.kind === 'event')).toHaveLength(4);
    cleanup();
    const days = renderList('om-13', 'dias-ativos');
    expect(days.rows).toHaveLength(lists.activeDays.length);
    expect(days.thumbs).toHaveLength(0);
  });

  it('marks the VIP order with the order thumbnail', () => {
    expect(insightsOf('om-03').last30.orders).toBe(1);
    const { thumbs } = renderList('om-03', 'acoes-fortes');
    expect([...thumbs].filter((thumb) => thumb.dataset.kind === 'order')).toHaveLength(1);
  });
});

describe('OwnerMemberList moments (quick 261013-uoi F-4)', () => {
  it('reads "hoje às HH:MM" and "ontem às HH:MM", always with "às"', () => {
    const { rows } = renderList('om-13', 'curtidas');
    const texts = [...rows].map((row) => row.textContent ?? '');
    const last = insightsOf('om-13').lastActive;
    expect(last.daysAgo).toBe(0);
    expect(texts[0]).toContain(`curtido hoje às ${last.time}`);
    for (const text of texts) expect(text).not.toMatch(/(hoje|ontem) \d{2}:\d{2}/);
    cleanup();

    // A member with a like yesterday that is not their last day: it reads with its own time too.
    const member = ownerBandRoster.find(
      (row) =>
        row.lastActive.daysAgo !== 1 &&
        insightsOf(row.id).lists.likes.some((like) => like.when.daysAgo === 1),
    );
    if (!member) throw new Error('no member liked yesterday');
    const yesterday = [...renderList(member.id, 'curtidas').rows].map((row) => row.textContent);
    expect(
      yesterday.some((text) => /curtido ontem às \d{2}:\d{2}$/.test(text ?? '')),
      member.id,
    ).toBe(true);
  });
});

describe('OwnerMemberList as the member report list', () => {
  it('reads across the area on the rising surface, with no "exemplo" pill', () => {
    const { container } = render(
      <OwnerMemberList t={t} memberId="om-13" list="posts-vistos" backHref="/voltar" />,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('@4xl:col-span-full');
    const list = container.querySelector('ul');
    const surface = list?.parentElement;
    expect(surface?.classList.contains('dash-reveal'), 'RISE').toBe(true);
    expect(surface?.classList.contains('rounded-2xl'), 'SURFACE').toBe(true);
    expect(container.textContent).not.toContain('exemplo');
  });
});
