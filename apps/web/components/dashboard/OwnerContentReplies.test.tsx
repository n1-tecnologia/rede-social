// @vitest-environment happy-dom
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownerContentItem, ownerContentUnanswered } from '@rede-social/module-dashboard/fixtures';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { contentTabView } from '@/lib/owner-content-view';
import type { DashboardT } from './format';
import { OwnerContentReplies } from './OwnerContentReplies';

/**
 * The unanswered comments screen (quick 261013-orf E-02) on the REAL pt-BR catalog: the
 * publication's thumbnail and caption, the overview row's count, then each unanswered comment,
 * oldest first, with who, their band, the text, when, and a disabled "Responder".
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

describe('OwnerContentReplies (quick 261013-orf E-02)', () => {
  it('lists the 9 unanswered comments of op-19, oldest first, each with its text', () => {
    const { container } = render(
      <OwnerContentReplies t={t} view={{ ...contentTabView('overview'), reply: 'op-19' }} />,
    );
    expect(container.querySelectorAll('[data-testid="cover-thumb"]')).toHaveLength(1);
    expect(container.textContent).toContain(ownerContentItem('op-19').excerpt);
    expect(container.textContent).toContain('9 comentários sem resposta · o mais antigo há 8 dias');
    // Quick 261013-uoi F-7: thumbnail, caption and meta are one link to the publication's detail.
    const links = container.querySelectorAll('a[href*="post="]');
    expect(links).toHaveLength(1);
    const header = links[0];
    expect(header?.getAttribute('href')).toBe('/perfil?area=conteudo&post=op-19');
    expect(header?.querySelector('[data-testid="cover-thumb"]')).not.toBeNull();
    expect(header?.textContent).toContain(ownerContentItem('op-19').excerpt);
    // The member report's look: the publication a linked surface, the comments rising cards.
    expect(header?.querySelector('.dash-reveal')).not.toBeNull();
    expect(header?.textContent).toContain('Ver detalhes');
    expect(container.querySelector('ul[data-dash-stagger]')).not.toBeNull();
    const rows = container.querySelectorAll('li');
    const comments = ownerContentUnanswered('op-19');
    expect(rows).toHaveLength(9);
    expect(rows[0]?.textContent).toContain('Comentou há 8 dias');
    for (const [i, row] of [...rows].entries()) {
      const comment = comments[i];
      expect(comment).toBeDefined();
      expect(row.textContent).toContain(comment?.person.name ?? '');
      expect(row.textContent).toContain(
        t(`tenantOwner.memberDetail.band.${comment?.person.band ?? 'new'}`),
      );
      expect(row.textContent).toContain(comment?.text ?? '');
      expect(row.querySelector('.dash-reveal')).not.toBeNull();
      const button = row.querySelector('button');
      expect(button?.textContent).toBe('Responder');
      expect(button?.disabled).toBe(true);
    }
  });
});
