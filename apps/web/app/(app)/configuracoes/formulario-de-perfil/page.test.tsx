// @vitest-environment node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { renderToReadableStream } from 'react-dom/server.browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { adminQuestion, archivedQuestion } from '@/lib/profile-form/test-fixtures';

/**
 * 12-15 Task 1 (D-596, UI-D-564..UI-D-568; PFORM-02, PFORM-23): the builder page against the real
 * catalog, the real loaders and the real components. Only the API boundary and the router are stubbed.
 * Rendered through the streaming renderer so the server tree and the client rows both resolve.
 */

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  requireBootstrap: vi.fn(),
}));
const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

vi.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => mocks.apiFetch(...args) }));
vi.mock('@/lib/bootstrap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bootstrap')>()),
  requireBootstrap: () => mocks.requireBootstrap(),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('./actions', () => ({
  reorderQuestionsAction: vi.fn(),
  readImpactAction: vi.fn(),
  reactivateQuestionAction: vi.fn(),
}));
vi.mock('@rede-social/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@rede-social/ui')>()),
  useToast: () => ({ show: vi.fn(), dismiss: vi.fn() }),
}));

const { default: ProfileFormPage } = await import('./page');

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const bootstrapWith = (permissions: string[]) => ({
  membership: { role: 'admin_tenant' },
  permissions,
  tenant: { displayName: 'Ana Mentoria', timezone: 'America/Sao_Paulo' },
});

/** Serves the builder API by path; a missing path is a test bug. */
function serve(routes: {
  questions?: unknown | Response;
  summary?: unknown | Response;
  archived?: unknown | Response;
}) {
  const pick = (value: unknown) => (value instanceof Response ? value.clone() : json(200, value));
  mocks.apiFetch.mockImplementation(async (path: string) => {
    if (path === '/v1/profile_form/questions' && routes.questions !== undefined) {
      return pick(routes.questions);
    }
    if (path === '/v1/profile_form/summary' && routes.summary !== undefined) {
      return pick(routes.summary);
    }
    if (path === '/v1/profile_form/archived' && routes.archived !== undefined) {
      return pick(routes.archived);
    }
    throw new Error(`unexpected request ${path}`);
  });
}

const list = (questions: ReturnType<typeof adminQuestion>[], limit = 30) => ({
  questions,
  activeCount: questions.length,
  limit,
});

async function html(aba?: string): Promise<string> {
  const ui = await ProfileFormPage({
    searchParams: Promise.resolve(aba === undefined ? {} : { aba }),
  });
  const stream = await renderToReadableStream(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
  await stream.allReady;
  return new Response(stream).text();
}

/** The text of the page with the markup gone, so a sentence split by tags still matches. */
const textOf = (out: string) =>
  out
    .replace(/<!--.*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireBootstrap.mockResolvedValue(bootstrapWith(['profile_form.manage']));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the permission literal', () => {
  it('is the one the module publishes', () => {
    const contracts = readFileSync(
      join(
        process.cwd(),
        '..',
        '..',
        'packages',
        'modules',
        'profile-form',
        'contracts',
        'index.ts',
      ),
      'utf8',
    );
    expect(contracts).toContain("manage: 'profile_form.manage'");
  });
});

describe('the gate (T-12-33, UI-D-564)', () => {
  it('answers notFound without profile_form.manage, whatever the role, and reads nothing', async () => {
    mocks.requireBootstrap.mockResolvedValue({
      ...bootstrapWith([]),
      membership: { role: 'support_tenant' },
    });
    await expect(html()).rejects.toThrow('NOT_FOUND');
    mocks.requireBootstrap.mockResolvedValue({
      ...bootstrapWith(['members.manage', 'moderation.manage']),
      membership: { role: 'member' },
    });
    await expect(html()).rejects.toThrow('NOT_FOUND');
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('answers notFound when the API says the module is off (404) or the permission was lost (403)', async () => {
    serve({
      questions: json(404, { error: { code: 'MODULE_DISABLED' } }),
      summary: json(404, { error: { code: 'MODULE_DISABLED' } }),
    });
    await expect(html()).rejects.toThrow('NOT_FOUND');
    serve({
      questions: json(403, { error: { code: 'FORBIDDEN' } }),
      summary: json(403, { error: { code: 'FORBIDDEN' } }),
    });
    await expect(html()).rejects.toThrow('NOT_FOUND');
  });
});

describe('the frame and the tabs (UI-D-564, UI-D-565)', () => {
  it('renders the title, the Voltar link to /configuracoes, both tabs and the intro', async () => {
    serve({
      questions: list([adminQuestion('short_text', { title: 'Qual é o seu cargo?' })]),
      summary: { total: 8, complete: 3, hasRequired: true },
    });
    const out = await html();
    expect(out).toContain('Formulário de perfil');
    expect(out).toContain('href="/configuracoes"');
    expect(out).toContain('Áreas do Formulário de perfil');
    expect(out).toContain('Perguntas');
    expect(out).toContain('Arquivadas');
    expect(textOf(out)).toContain(
      'Monte as perguntas que os membros de Ana Mentoria respondem. As alterações valem assim que você salva.',
    );
    expect(out).toContain('max-w-[680px]');
  });

  it('reads an unknown or repeated ?aba= as Perguntas (the list is read, not the archive)', async () => {
    serve({
      questions: list([adminQuestion('email', { title: 'Seu e-mail' })]),
      summary: { total: 2, complete: 1, hasRequired: true },
    });
    for (const aba of ['qualquer', 'ARQUIVADAS']) {
      mocks.apiFetch.mockClear();
      const out = await html(aba);
      expect(out).toContain('Seu e-mail');
      expect(mocks.apiFetch).not.toHaveBeenCalledWith('/v1/profile_form/archived');
    }
  });
});

describe('the summary card (UI-D-566)', () => {
  it('shows the ring, "{done} de {total} membros completos" and the pending line', async () => {
    serve({
      questions: list([adminQuestion('short_text', { required: true })]),
      summary: { total: 8, complete: 3, hasRequired: true },
    });
    const out = await html();
    expect(out).toContain('data-progress-ring');
    expect(out).toContain('data-percent="38"');
    expect(textOf(out)).toContain('3 de 8 membros completos');
    expect(textOf(out)).toContain('5 membros ainda precisam responder.');
    expect(out).toContain('38%');
  });

  it('uses the singular and the definition line when everyone is complete', async () => {
    serve({
      questions: list([adminQuestion('short_text', { required: true })]),
      summary: { total: 1, complete: 1, hasRequired: true },
    });
    const out = await html();
    expect(textOf(out)).toContain('1 de 1 membro completo');
    expect(textOf(out)).toContain('Completo é quem respondeu todas as perguntas obrigatórias.');
  });

  it('hides the ring and says "Nenhuma pergunta obrigatória" without a required question', async () => {
    serve({
      questions: list([adminQuestion('short_text')]),
      summary: { total: 8, complete: 8, hasRequired: false },
    });
    const out = await html();
    expect(out).not.toContain('data-progress-ring');
    expect(textOf(out)).toContain('Nenhuma pergunta obrigatória');
    expect(textOf(out)).toContain(
      'Ninguém precisa responder para continuar. As respostas são opcionais.',
    );
  });

  it('hides the ring and says "Ainda não há membros" without members', async () => {
    serve({
      questions: list([adminQuestion('short_text', { required: true })]),
      summary: { total: 0, complete: 0, hasRequired: true },
    });
    const out = await html();
    expect(out).not.toContain('data-progress-ring');
    expect(textOf(out)).toContain('Ainda não há membros');
    expect(textOf(out)).toContain('Quando alguém entrar, o andamento aparece aqui.');
  });
});

describe('the question rows (UI-D-566)', () => {
  it('renders each row as one button with the position, title, badge, state and count', async () => {
    serve({
      questions: list([
        adminQuestion('short_text', {
          title: 'Qual é o seu cargo?',
          required: true,
          showOnProfile: true,
          answerCount: 3,
        }),
        adminQuestion('dropdown', { title: 'Como conheceu a comunidade?' }),
        adminQuestion('acceptance', { title: 'Li e aceito', answerCount: 1 }),
      ]),
      summary: { total: 8, complete: 3, hasRequired: true },
    });
    const out = await html();
    const text = textOf(out);
    expect(out).toContain('aria-label="Editar pergunta: Qual é o seu cargo?"');
    expect(out).toContain('aria-label="Editar pergunta: Como conheceu a comunidade?"');
    expect(text).toContain('Perguntas ativas (3)');
    expect(text).toContain('Texto curto');
    expect(text).toContain('Lista suspensa');
    expect(text).toContain('Aceite');
    expect(text).toContain('No perfil');
    expect(text).toContain('3 respostas');
    expect(text).toContain('1 resposta');
    expect(text).toContain('Sem respostas');
    expect(text).toContain('Obrigatória');
    expect(text).toContain('Opcional');
    // the three line clamp and the wrap rule are on the title
    expect(out).toContain('line-clamp-3 break-words');
    // each row is described by its position and state, for assistive tech
    expect(text).toContain('Pergunta 1 de 3. Obrigatória. 3 respostas.');
    expect(text).toContain('Pergunta 2 de 3. Opcional. Sem respostas.');
  });

  it('shows the lock only for a question with answers, and the pill only for a public one', async () => {
    serve({
      questions: list([adminQuestion('short_text', { title: 'Privada, sem respostas' })]),
      summary: { total: 2, complete: 1, hasRequired: true },
    });
    const out = await html();
    expect(out).not.toContain('Tipo bloqueado');
    expect(out).not.toContain('No perfil');

    serve({
      questions: list([adminQuestion('short_text', { title: 'Com resposta', answerCount: 2 })]),
      summary: { total: 2, complete: 1, hasRequired: true },
    });
    const locked = await html();
    expect(locked).toContain('Tipo bloqueado');
    expect(locked).not.toContain('No perfil');
  });

  it('renders a 120-character title with no spaces as text that may wrap, never as markup', async () => {
    const long = `<b>${'x'.repeat(117)}`;
    serve({
      questions: list([adminQuestion('short_text', { title: long })]),
      summary: { total: 2, complete: 1, hasRequired: true },
    });
    const out = await html();
    expect(out).not.toContain('<b>');
    expect(out).toContain('&lt;b&gt;');
    expect(out).toContain('break-words');
  });

  it('renders one question with the singular copy in the section title', async () => {
    serve({
      questions: list([adminQuestion('number', { answerCount: 1 })]),
      summary: { total: 2, complete: 1, hasRequired: true },
    });
    const text = textOf(await html());
    expect(text).toContain('Perguntas ativas (1)');
    expect(text).toContain('1 resposta');
  });

  it('shows the limit line at 30 active questions and not at 29', async () => {
    const make = (count: number) =>
      Array.from({ length: count }, (_, i) => adminQuestion('short_text', { title: `Q${i}` }));
    serve({ questions: list(make(30)), summary: { total: 2, complete: 1, hasRequired: true } });
    const at30 = await html();
    expect(textOf(at30)).toContain(
      'Você chegou ao limite de 30 perguntas ativas. Arquive uma para adicionar outra.',
    );
    serve({ questions: list(make(29)), summary: { total: 2, complete: 1, hasRequired: true } });
    expect(textOf(await html())).not.toContain('Você chegou ao limite');
  });
});

describe('the states (UI-D-568)', () => {
  it('shows the empty state, with no summary card, when no question exists at all', async () => {
    serve({
      questions: list([]),
      summary: { total: 8, complete: 8, hasRequired: false },
      archived: { questions: [] },
    });
    const out = await html();
    const text = textOf(out);
    expect(text).toContain('Seu formulário ainda está vazio');
    expect(text).toContain('Crie perguntas para conhecer melhor os membros.');
    expect(out).not.toContain('data-form-summary');
    expect(out).not.toContain('Perguntas ativas');
  });

  it('keeps the summary card above the empty state when only archived questions exist', async () => {
    serve({
      questions: list([]),
      summary: { total: 8, complete: 3, hasRequired: true },
      archived: { questions: [archivedQuestion('phone')] },
    });
    const out = await html();
    expect(out).toContain('data-form-summary');
    expect(textOf(out)).toContain('Seu formulário ainda está vazio');
  });

  it('shows the "Algo deu errado" card with a retry link to the same URL when a read fails', async () => {
    serve({
      questions: json(500, {}),
      summary: { total: 8, complete: 3, hasRequired: true },
    });
    const out = await html();
    const text = textOf(out);
    expect(text).toContain('Algo deu errado');
    expect(text).toContain('Não foi possível carregar o formulário agora.');
    expect(out).toContain('data-profile-form-error');
    expect(out).toMatch(
      /<a[^>]*href="\/configuracoes\/formulario-de-perfil"[^>]*>[^<]*Tentar novamente/,
    );
    expect(out).not.toContain('data-form-summary');
  });
});

describe('aggregates only (PFORM-23)', () => {
  it('never reads an individual answer: only the three builder reads are made', async () => {
    serve({
      questions: list([adminQuestion('short_text')]),
      summary: { total: 2, complete: 1, hasRequired: true },
    });
    await html();
    const paths = mocks.apiFetch.mock.calls.map((call) => String(call[0]));
    for (const path of paths) {
      expect(path).toMatch(/^\/v1\/profile_form\/(questions|summary|archived)$/);
    }
    expect(paths.some((path) => path.includes('profile-answers'))).toBe(false);
  });
});
