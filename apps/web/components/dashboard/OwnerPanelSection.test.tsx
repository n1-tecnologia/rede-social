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
/**
 * 08.7-05: Membros reads `getOwnerMembers()` and its band lists. The suite answers them with a small
 * ready snapshot (one community, one event, contract-shaped member rows), so the walk below reaches
 * every Membros link shape with no API.
 */
const membersData = vi.hoisted(() => {
  const counts = { new: 2, superfan: 1, engaged: 12, occasional: 3, at_risk: 2, inactive: 0 };
  const bands = { counts, newActivated: 1 };
  const snapshot = (now: number) => overviewSnapshot(now);
  function overviewSnapshot(now: number) {
    const day = new Date(now - 86_400_000 - 3 * 3_600_000).toISOString().slice(0, 10);
    const today = new Date(now - 3 * 3_600_000).toISOString().slice(0, 10);
    return {
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
    };
  }
  const community = '11111111-1111-4111-8111-111111111111';
  const event = '33333333-3333-4333-8333-333333333333';
  return {
    members: (now: number) => ({
      status: 'ok',
      answer: {
        state: 'ready',
        snapshot: snapshot(now),
        growth: {
          joined: 2,
          weeklyJoined: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
          left: { measured: false, reason: 'needs_member_exit' },
          balance: { measured: false, reason: 'needs_member_exit' },
        },
        engagement: bands,
        movement: { up: 1, down: 0, flows: [{ from: 'occasional', to: 'engaged', members: 1 }] },
        cohorts: [{ month: '2026-08', values: [100, 50] }],
        atRiskWithPush: 1,
        communityEngagement: [
          {
            id: community,
            name: 'Geral',
            description: 'Para todos.',
            coverAssetId: null,
            exclusive: false,
            bands,
            atRiskWithPush: 1,
            members: 20,
            activeWeek: 5,
            posts: 3,
            interactions: 9,
          },
        ],
        eventEngagement: [
          {
            id: event,
            title: 'Encontro',
            startsAt: '2026-11-10T22:00:00Z',
            endsAt: '2026-11-11T00:00:00Z',
            format: 'online',
            coverAssetId: null,
            bands,
            atRiskWithPush: 0,
          },
        ],
      },
    }),
    detail: (now: number) => ({
      status: 'ok',
      answer: {
        state: 'ready',
        snapshot: snapshot(now),
        member: {
          membershipId: '00000000-0000-4000-8000-000000000001',
          displayName: 'Membro 1',
          avatarAssetId: null,
          joinedAt: '2026-09-02T13:00:00Z',
          lastActiveAt: null,
          band: 'engaged',
        },
        topCommunity: null,
        bandHistory: [
          { month: '2026-08', band: null },
          { month: '2026-09', band: 'new' },
          { month: '2026-10', band: 'engaged' },
        ],
        last30: {
          activeDays: 1,
          likes: 1,
          comments: 0,
          checkIns: 0,
          orders: 0,
          strongActions: 0,
          dailyMinutes: { measured: false, reason: 'needs_usage_sessions' },
          postsSeen: { measured: false, reason: 'needs_post_views' },
        },
        weeklyActiveDays: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
        communities: [],
        postTypes: [],
        events: [],
        purchases: [],
        support: { conversations: 0, lastDaysAgo: null, medianResponseMinutes: null },
        suggestion: { kind: 'engaged', days: 1 },
      },
    }),
    list: (now: number) => ({
      status: 'ok',
      answer: {
        state: 'ready',
        snapshot: snapshot(now),
        list: 'active-days',
        rows: [{ day: '2026-10-10', actions: 2 }],
        nextCursor: null,
      },
    }),
    band: (now: number) => ({
      status: 'ok',
      answer: {
        state: 'ready',
        snapshot: snapshot(now),
        total: 2,
        nextCursor: null,
        rows: [1, 2].map((n) => ({
          membershipId: `00000000-0000-4000-8000-00000000000${n}`,
          displayName: `Membro ${n}`,
          avatarAssetId: null,
          joinedAt: '2026-09-02T13:00:00Z',
          lastActiveAt: null,
          topCommunity: null,
          dailyMinutes: { measured: false, reason: 'needs_usage_sessions' },
        })),
      },
    }),
  };
});
/**
 * 08.7-07: Conteúdo reads `getOwnerContent()` and its detail and lists. The suite answers them with
 * contract-shaped data (`owner-content-test-data.ts`): a video waiting for the team, a photo and a
 * story, so the walk reaches the post detail, who liked and commented, the interactions and the
 * comments waiting for the team.
 */
async function contentData() {
  const data = await import('./owner-content-test-data');
  const video = data.contentPost(1, {
    kind: 'video',
    likes: 12,
    comments: 3,
    durationSeconds: 75,
    commentMeta: {
      answered: 1,
      unanswered: 2,
      oldestUnansweredHours: 30,
      firstReplyMedianMinutes: 20,
    },
  });
  const photo = data.contentPost(2, { likes: 4, comments: 0 });
  const story = data.contentStory(9, { viewers: 6, comments: 1 });
  const snapshot = data.contentSnapshot();
  const member = {
    membershipId: '00000000-0000-4000-8000-000000000001',
    displayName: 'Membro 1',
    avatarAssetId: null,
    band: 'engaged' as const,
  };
  return {
    area: data.contentAnswer([video, photo, story], {
      heatmap: data.contentHeatmap([{ weekday: 'wed', fromHour: 12, posts: 2, interactions: 19 }]),
      interactorsByBand: {
        new: 0,
        superfan: 1,
        engaged: 3,
        occasional: 0,
        at_risk: 0,
        inactive: 0,
      },
    }),
    detail: (id: string) => {
      const item = [video, photo, story].find((row) => row.id === id) ?? video;
      return data.contentDetail(item);
    },
    page: { state: 'ready' as const, snapshot, total: 1, nextCursor: null },
    member,
  };
}
/**
 * 08.7-08: Eventos reads `getOwnerEvents()`. The suite answers one upcoming and one past event, so
 * the walk meets both kinds of event row and their attendee-list links (D-461).
 */
async function eventsData() {
  const data = await import('./owner-content-test-data');
  const ticket = { measured: false, reason: 'needs_event_tickets' } as const;
  const event = (n: number) => ({
    id: data.contentId(n, '77777777-7777-4777-8777'),
    title: `Evento ${n}`,
    startsAt: '2026-10-24T22:00:00.000000Z',
    endsAt: '2026-10-25T00:00:00.000000Z',
    format: 'in_person' as const,
    capacity: 50,
    confirmed: 12,
    durationMinutes: 120,
    coverAssetId: null,
    ticketCents: ticket,
    revenue: ticket,
  });
  return {
    status: 'ok' as const,
    answer: {
      state: 'ready' as const,
      snapshot: data.contentSnapshot(),
      upcoming: [event(1)],
      past: [{ ...event(2), checkIns: 9, walkIns: 1 }],
      attendanceTotals: {
        current: { confirmed: 12, present: 10, walkIns: 1 },
        previous: { confirmed: 0, present: 0, walkIns: 0 },
      },
      attendanceByBand: { new: 1, superfan: 2, engaged: 3, occasional: 4, at_risk: 0, inactive: 0 },
      waitlist: { measured: false, reason: 'needs_waitlist' } as const,
    },
  };
}
vi.mock('@/lib/dashboard', () => ({
  getOwnerEvents: async () => eventsData(),
  getOwnerOverview: async () => overview.result ?? overview.ready(Date.now()),
  getOwnerMembers: async () => membersData.members(Date.now()),
  getOwnerBandMembers: async () => membersData.band(Date.now()),
  getOwnerMemberDetail: async () => membersData.detail(Date.now()),
  getOwnerMemberList: async () => membersData.list(Date.now()),
  getOwnerContent: async () => ({ status: 'ok', answer: (await contentData()).area }),
  getOwnerContentDetail: async (id: string) => ({
    status: 'ok',
    answer: (await contentData()).detail(id),
  }),
  getOwnerContentPeople: async (_id: string, who: 'likes' | 'comments') => {
    const { page, member } = await contentData();
    const row = { id: '00000000-0000-4000-8000-0000000000a1', at: '2026-10-10T12:00:00Z', member };
    return {
      status: 'ok',
      answer: { ...page, who, rows: [who === 'comments' ? { ...row, answered: false } : row] },
    };
  },
  getOwnerContentInteractions: async () => {
    const { page, member, area } = await contentData();
    const itemId = area.items[0]?.id ?? '';
    return {
      status: 'ok',
      answer: {
        ...page,
        rows: [
          {
            kind: 'like',
            id: '00000000-0000-4000-8000-0000000000b1',
            at: '2026-10-10T12:00:00Z',
            itemId,
            member,
          },
        ],
      },
    };
  },
  getOwnerContentUnanswered: async () => {
    const { page, member, area } = await contentData();
    const postId = area.items[0]?.id ?? '';
    return {
      status: 'ok',
      answer: {
        ...page,
        rows: [
          {
            id: '00000000-0000-4000-8000-0000000000c1',
            postId,
            at: '2026-10-10T12:00:00Z',
            text: 'Quando?',
            member,
          },
        ],
      },
    };
  },
}));
vi.mock('@/app/(app)/perfil/dashboard-actions', () => ({
  loadMoreOwnerListAction: async () => ({ error: true }),
}));

const { OwnerPanelSection } = await import('./OwnerPanelSection');

/** Every panel module on, as rede-demo. */
const ALL_ON = {
  feed: true,
  stories: true,
  communities: true,
  events: true,
  store: true,
  chat: true,
  notifications: true,
} as const;

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
      flags={ALL_ON}
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

  it('links only to /perfil (Configurações, a post page or an attendee list) and names no other client, on every screen a link reaches', {
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
    let postPages = 0;
    let attendeePages = 0;
    while (queue.length > 0) {
      const url = queue.shift() as string;
      const markup = await panelAt(url);
      for (const pattern of CLIENT_NAMES)
        if (pattern.test(markup)) names.push(`${url}: ${pattern}`);
      for (const href of hrefsOf(markup)) {
        if (href === '/configuracoes') continue;
        // 08.7-07 (D-461): a publication plays, and its waiting comments are answered, on its post page.
        if (/^\/post\/[0-9a-f-]{36}$/.test(href)) {
          postPages += 1;
          continue;
        }
        // 08.7-08 (D-461): an event row opens the event's attendee list.
        if (/^\/eventos\/[0-9a-f-]{36}\/participantes$/.test(href)) {
          attendeePages += 1;
          continue;
        }
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
    // 08.7-07: Conteúdo on its answers was walked to its detail, its people, its interactions and
    // the comments waiting for the team, whose "Responder" and the video's play open the post page.
    for (const shape of [
      'area=conteudo&post=*',
      'area=conteudo&post=*&quem=curtidas',
      'area=conteudo&numero=interacoes',
      'area=conteudo&responder=*',
    ]) {
      expect([...shapes], shape).toContain(shape);
    }
    expect(postPages).toBeGreaterThan(0);
    // 08.7-08: Eventos on its answer links its upcoming card and its past row to their attendee lists.
    expect(attendeePages).toBeGreaterThanOrEqual(2);
    // Every area and their lists and details were walked (a few hundred screens).
    expect(shapes.size).toBeGreaterThan(100);
  });
});
