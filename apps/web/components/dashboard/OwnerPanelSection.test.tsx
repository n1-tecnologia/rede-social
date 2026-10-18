import type { ReactElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it, vi } from 'vitest';
import { OWNER_AREAS } from '@/lib/owner-panel';
import type { HostShell } from '@/lib/tenant-host';

/**
 * The owner panel on `/perfil` (2026-10-15), rendered whole on the server as the page does, on the
 * REAL pt-BR catalog. Pins what the port promised: the header and tabs of the source screen, the
 * real tenant (name and host) in place of the preview's client, every link rebuilt for `/perfil`,
 * and no name of another client anywhere in the panel, on any screen a link reaches.
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  // Vitest runs from `apps/web` (the `ParticipantsList.test.tsx` precedent).
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace } as never),
  };
});

/**
 * 08.7-01: Visão geral reads the tenant's snapshot through `getOwnerOverview()`. The suite answers it
 * here (no API): a ready snapshot of the São Paulo yesterday built today at 00:30 local, unless a
 * case swaps in `preparing` or a failed read.
 */
const overview = vi.hoisted(() => ({
  result: null as unknown,
  ready: (now: number) => {
    const day = new Date(now - 86_400_000 - 3 * 3_600_000).toISOString().slice(0, 10);
    const today = new Date(now - 3 * 3_600_000).toISOString().slice(0, 10);
    return {
      status: 'ok',
      answer: {
        state: 'ready',
        snapshot: {
          day,
          builtAt: `${today}T03:30:00.000Z`,
          windows: {
            day,
            from30: day,
            prev30From: day,
            from7: day,
            prev7From: day,
            from30At: `${day}T03:00:00Z`,
            prev30At: `${day}T03:00:00Z`,
            untilAt: `${today}T03:00:00Z`,
          },
        },
        members: { count: 1234, newMembers: 12, previous: 1200 },
      },
    };
  },
}));
vi.mock('@/lib/dashboard', () => ({
  getOwnerOverview: async () => overview.result ?? overview.ready(Date.now()),
}));

const { OwnerPanelSection } = await import('./OwnerPanelSection');

/** A verified tenant host: the one the page is served on is the tenant's primary (proxy.ts 308s). */
const TENANT_HOST: HostShell = {
  mode: 'tenant',
  host: 'comunidade.rede-demo.com.br',
  slug: 'rede-demo',
  displayName: 'Rede Demo',
};

async function html(element: ReactElement): Promise<string> {
  const { prelude } = await prerender(element);
  const reader = prelude.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

/** The panel at `url` (a `/perfil` link), as the page renders it for an admin. */
function panelAt(url: string, host: HostShell = TENANT_HOST) {
  const query = Object.fromEntries(new URLSearchParams(url.split('?')[1] ?? '').entries());
  return html(
    <OwnerPanelSection
      tenantName="Rede Demo"
      branding={{}}
      host={host}
      query={query as Record<string, string>}
      timeZone="America/Sao_Paulo"
    />,
  );
}

/** The decoded hrefs of a rendered screen. */
function hrefsOf(markup: string): string[] {
  return [...markup.matchAll(/href="([^"]*)"/g)].map((match) =>
    (match[1] ?? '').replaceAll('&amp;', '&'),
  );
}

/** The visible text of a rendered screen (tags dropped, entities kept as is). */
function textOf(markup: string): string {
  return markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

/** No other client's name may reach the panel (Igor Alves is another client of the owner). */
const CLIENT_NAMES = [/\bIgor\b/i, /drigoralves/i, /\bInstituto\b/i];

describe('the owner panel on /perfil', () => {
  it('draws the header of the source screen with the real tenant', async () => {
    const markup = await panelAt('/perfil');
    const text = textOf(markup);
    expect(text).toContain('Rede Demo');
    expect(text).toContain('Visão do dono');
    expect(text).toContain('30 dias');
    // The bell names its three alerts, one of them urgent.
    expect(markup).toContain('aria-label="Alertas, 3, 1 urgente"');
    expect(markup).toContain('id="painel-do-dono"');
    expect(markup).toMatch(/class="[^"]*@container/);
  });

  it('has the six areas as tabs that stay on /perfil', async () => {
    const hrefs = hrefsOf(await panelAt('/perfil'));
    for (const area of OWNER_AREAS) expect(hrefs).toContain(`/perfil?area=${area}`);
    const text = textOf(await panelAt('/perfil'));
    for (const label of [
      'Visão geral',
      'Membros',
      'Conteúdo',
      'Eventos',
      'Financeiro',
      'Atendimento',
    ]) {
      expect(text).toContain(label);
    }
  });

  it('shows the six overview cards, the account with the tenant’s host and the admin card', async () => {
    const markup = await panelAt('/perfil');
    const text = textOf(markup);
    for (const label of [
      'Membros',
      'Engajados',
      'Interações por publicação',
      'Comparecimento em eventos',
      'Vendas do mês',
      'Conversas aguardando resposta',
    ]) {
      expect(text).toContain(label);
    }
    expect(text).toContain('Plano Pro');
    expect(text).toContain('Domínio verificado');
    expect(text).toContain('Domínio: comunidade.rede-demo.com.br');
    expect(text).toContain('Ver operação do dia (painel do admin)');
    expect(hrefsOf(markup)).toContain('/configuracoes');
  });

  it('08.7: the members card reads the snapshot, after the freshness line in the tenant’s time', async () => {
    overview.result = null;
    const markup = await panelAt('/perfil');
    const text = textOf(markup);
    // 1.234 against 1.200 thirty days before: the shipped chip (3%), no sample number.
    expect(text).toContain('1.234');
    expect(text).toContain('3%');
    // Built 03:30Z = 00:30 in São Paulo, today, for yesterday.
    expect(text).toContain('Números até ontem · atualizados hoje às 00:30');
    expect(markup.indexOf('data-snapshot-freshness')).toBeLessThan(markup.indexOf('data-kpi-card'));
    expect(markup).not.toContain('data-owner-area-state');
  });

  it('08.7: before the first snapshot the area is the preparing card, with no freshness line and no number', async () => {
    overview.result = { status: 'ok', answer: { state: 'preparing' } };
    try {
      const markup = await panelAt('/perfil');
      const text = textOf(markup);
      expect(markup).toContain('data-owner-area-state="preparing"');
      expect(text).toContain('Seus números estão sendo preparados');
      expect(markup).not.toContain('data-snapshot-freshness');
      expect(markup).not.toContain('data-kpi-card');
      // The header and the area row stay.
      expect(text).toContain('Visão do dono');
      expect(hrefsOf(markup)).toContain('/perfil?area=membros');
    } finally {
      overview.result = null;
    }
  });

  it('08.7: a failed read is the area’s error card with a retry on the same screen, never the app error page', async () => {
    overview.result = { status: 'error' };
    try {
      const markup = await panelAt('/perfil');
      const text = textOf(markup);
      expect(markup).toContain('data-owner-area-state="error"');
      expect(text).toContain('Algo deu errado');
      expect(text).toContain('Tentar novamente');
      expect(hrefsOf(markup)).toContain('/perfil?area=visao-geral#painel-do-dono');
      expect(markup).not.toContain('data-snapshot-freshness');
      expect(text).toContain('Visão do dono');
    } finally {
      overview.result = null;
    }
  });

  it('reads the host the page was served on, unverified, on a generic host', async () => {
    const text = textOf(await panelAt('/perfil', { mode: 'generic', host: 'preview.vercel.app' }));
    expect(text).toContain('Domínio: preview.vercel.app');
    expect(text).toContain('Domínio pendente');
  });

  it('switches areas through ?area= and falls back to Visão geral', async () => {
    expect(await panelAt('/perfil?area=membros')).toContain('data-owner-area="membros"');
    expect(await panelAt('/perfil?area=financeiro')).toContain('data-owner-area="financeiro"');
    expect(await panelAt('/perfil?area=nada')).toContain('data-owner-area="visao-geral"');
  });

  it('links only to /perfil (and Configurações) and names no other client, on every screen a link reaches', {
    timeout: 120_000,
  }, async () => {
    // One screen per link shape (the ids of members, posts and products abstracted), from /perfil.
    const ids = new Set([
      'membro',
      'post',
      'responder',
      'produto',
      'oferta',
      'evento',
      'comunidade',
    ]);
    const shapeOf = (url: string) =>
      [...new URLSearchParams(url.split('?')[1] ?? '').entries()]
        .map(([key, value]) => (ids.has(key) ? `${key}=*` : `${key}=${value}`))
        .sort()
        .join('&');
    const queue = ['/perfil'];
    const seen = new Set(queue);
    const shapes = new Set([shapeOf('/perfil')]);
    const strays: string[] = [];
    const names: string[] = [];
    while (queue.length > 0) {
      const url = queue.shift() as string;
      const markup = await panelAt(url);
      for (const pattern of CLIENT_NAMES)
        if (pattern.test(markup)) names.push(`${url}: ${pattern}`);
      for (const href of hrefsOf(markup)) {
        if (href === '/configuracoes') continue;
        if (!/^\/perfil\?area=[a-z-]+(&[a-z]+=[\w-]+)*(#[\w-]+)?$/.test(href)) {
          strays.push(`${url} -> ${href}`);
          continue;
        }
        const bare = href.split('#')[0] as string;
        if (seen.has(bare)) continue;
        seen.add(bare);
        const shape = shapeOf(bare);
        if (shapes.has(shape)) continue;
        shapes.add(shape);
        queue.push(bare);
      }
    }
    expect(strays).toEqual([]);
    expect(names).toEqual([]);
    // Every area and their lists and details were walked (a few hundred screens).
    expect(shapes.size).toBeGreaterThan(100);
  });
});
