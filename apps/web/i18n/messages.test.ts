import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assembleMessages, loadMessages } from './messages';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const catalogDir = fileURLToPath(new URL('../messages/pt-BR/', import.meta.url));

function catalog(files: Record<string, unknown>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'tria-messages-'));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}

describe('loadMessages (PWA-03: one pt-BR catalog assembled from per-namespace files)', () => {
  it('returns the union of the file root keys; dotted files deep-merge into their namespace', () => {
    const dir = catalog({
      'common.json': { common: { appName: 'TRIA' } },
      'platform.json': { platform: { title: 'Plataforma TRIA', tenants: 'Tenants' } },
      'platform.list.json': { platform: { list: { newTenant: 'Novo tenant' } } },
    });
    expect(loadMessages(dir)).toEqual({
      common: { appName: 'TRIA' },
      platform: {
        title: 'Plataforma TRIA',
        tenants: 'Tenants',
        list: { newTenant: 'Novo tenant' },
      },
    });
  });

  it('keeps the same leaf key distinct across namespaces (login.title vs signup.title)', () => {
    const dir = catalog({
      'login.json': { login: { title: 'Entrar' } },
      'signup.json': { signup: { title: 'Criar conta' } },
    });
    expect(loadMessages(dir)).toEqual({
      login: { title: 'Entrar' },
      signup: { title: 'Criar conta' },
    });
  });

  it('throws naming both files when two files declare the same leaf path', () => {
    const dir = catalog({
      'platform.json': { platform: { title: 'Plataforma TRIA' } },
      'platform.list.json': { platform: { title: 'Tenants' } },
    });
    expect(() => loadMessages(dir)).toThrow(
      /Duplicate message key "platform\.title" in platform\.json and platform\.list\.json/,
    );
  });

  it('throws when a file root key does not equal the filename prefix before the first dot', () => {
    const dir = catalog({ 'platform.list.json': { list: { newTenant: 'Novo tenant' } } });
    expect(() => loadMessages(dir)).toThrow(/platform\.list\.json/);
  });

  it('throws on an empty object file, an empty namespace and a non-object root', () => {
    expect(() => loadMessages(catalog({ 'login.json': {} }))).toThrow(/login\.json/);
    expect(() => loadMessages(catalog({ 'login.json': { login: {} } }))).toThrow(/login\.json/);
    expect(() => loadMessages(catalog({ 'login.json': '["Entrar"]' }))).toThrow(/login\.json/);
    expect(() => loadMessages(catalog({ 'login.json': '"Entrar"' }))).toThrow(/login\.json/);
  });

  it('is deterministic: sorted filename order, pure merge, memoized per directory', () => {
    const dir = catalog({
      'b.json': { b: { x: '1' } },
      'a.json': { a: { y: '2' } },
      'a.z.json': { a: { z: { w: '3' } } },
    });
    const reversed = assembleMessages(dir, ['b.json', 'a.z.json', 'a.json']);
    const natural = assembleMessages(dir, ['a.json', 'a.z.json', 'b.json']);
    expect(reversed).toEqual(natural);
    expect(Object.keys(reversed)).toEqual(['a', 'b']);
    expect(Object.keys(reversed.a as object)).toEqual(['y', 'z']);
    expect(loadMessages(dir)).toEqual(natural);
    expect(loadMessages(dir)).toBe(loadMessages(dir));
  });

  it('ignores non-JSON files and never normalizes the strings (literal accents, ICU plurals)', () => {
    const dir = catalog({
      'README.md': '# not a catalog',
      'platform.json': {
        platform: {
          modulesCount: '{count, plural, =0 {nenhum módulo} one {# módulo} other {# módulos}}',
        },
      },
    });
    const messages = loadMessages(dir) as { platform: { modulesCount: string } };
    expect(messages.platform.modulesCount).toBe(
      '{count, plural, =0 {nenhum módulo} one {# módulo} other {# módulos}}',
    );
    expect(messages.platform.modulesCount.normalize('NFD')).not.toBe(
      messages.platform.modulesCount,
    );
  });

  it('assembles the real apps/web/messages/pt-BR catalog with every Phase 1 namespace present', () => {
    const messages = loadMessages(catalogDir);
    for (const ns of ['common', 'login', 'signup', 'forgot', 'reset', 'platform', 'app', 'legal']) {
      expect(messages, ns).toHaveProperty(ns);
    }
  });
});

/**
 * UI-D-46 — the retired sense of "comunidade" is closed inside the authenticated member/admin app.
 *
 * Ten shipped rows carried the word meaning *the tenant*. Six now name the tenant through a
 * `{tenant}` interpolation and four drop the word outright. Both halves are pinned here, and the
 * pin is the point: a later edit that deletes a `{tenant}` would not fail typecheck (the call site
 * would simply pass an argument nobody reads) and would ship a sentence with a hole in it. A
 * missing placeholder is a test failure instead.
 */
describe('UI-D-46 vocabulary amendment (the retired sense of "comunidade")', () => {
  const messages = loadMessages(catalogDir) as Record<string, unknown>;

  function at(dotted: string): string {
    const value = dotted
      .split('.')
      .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], messages);
    expect(typeof value, dotted).toBe('string');
    return value as string;
  }

  /**
   * The SIX rows that gain `{tenant}`. `media.errors.quota` is deliberately NOT here: the string
   * resolves in `useSignedUpload`, which two platform-panel components also call as `super_admin`
   * on `app.seusistema.com`, where no tenant display name exists — so that row drops the word
   * instead of naming a tenant it could not name.
   */
  it.each([
    'feed.empty.bodyAuthor',
    'feed.notFound.body',
    'feed.composer.captionPlaceholder',
    'app.home.soonBody',
    'members.empty.body',
    'members.notFound.body',
  ])('%s carries the {tenant} placeholder', (key) => {
    expect(at(key)).toContain('{tenant}');
  });

  /** The FOUR rows that drop the word. */
  it.each([
    ['feed.region', 'Feed principal'],
    ['profile.nudge.body', 'Adicione uma foto e uma bio para as pessoas te reconhecerem.'],
    ['media.confirm.removeVideo.body', 'O vídeo deixa de ficar disponível para os membros.'],
    ['media.errors.quota', 'O limite de armazenamento foi atingido. Fale com o administrador.'],
  ])('%s drops the retired sense outright', (key, expected) => {
    expect(at(key)).toBe(expected);
  });

  /** None of the ten may still carry a retired-sense phrase, interpolated or not. */
  it('no amended row still says "comunidade" in the retired sense', () => {
    const retired =
      /da comunidade|sua comunidade|desta comunidade|na comunidade|para a comunidade|A comunidade atingiu/;
    for (const key of [
      'feed.region',
      'feed.empty.bodyAuthor',
      'feed.notFound.body',
      'feed.composer.captionPlaceholder',
      'app.home.soonBody',
      'members.empty.body',
      'members.notFound.body',
      'profile.nudge.body',
      'media.confirm.removeVideo.body',
      'media.errors.quota',
    ]) {
      expect(at(key), key).not.toMatch(retired);
    }
  });

  /**
   * The 16 out-of-scope rows stay as they are (UI-SPEC groups A and B): in neither group can the
   * two meanings reach one screen, and `platform.moduleNames.communities` already carries the NEW
   * sense. One row from each group stands for its group here.
   */
  it('leaves the out-of-scope rows and the already-correct row untouched', () => {
    expect(at('noCommunity.title')).toContain('comunidade');
    expect(at('platformDomains.empty.body')).toContain('comunidade');
    expect(at('platform.moduleNames.communities')).toBe('Comunidades');
  });
});

/**
 * 05.1 — every string the phase added, pinned in the UI-SPEC's words (Copywriting Contract, "New
 * keys: 16"), plus each `{community}` / `{tenant}` placeholder and the reused words the phase
 * deliberately did NOT reword.
 *
 * The placeholder rows are the point: deleting a brace would not fail typecheck (the call site
 * would pass an argument nobody reads) and would ship a sentence with a hole in it. Here it is a
 * test failure instead.
 */
describe('05.1 — the new entry-point strings and their placeholders', () => {
  const messages = loadMessages(catalogDir) as Record<string, unknown>;

  function at(dotted: string): string {
    const value = dotted
      .split('.')
      .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], messages);
    expect(typeof value, dotted).toBe('string');
    return value as string;
  }

  it.each([
    ['communities.list.filter.label', 'Filtrar comunidades'],
    ['communities.list.filter.active', 'Ativas'],
    ['communities.list.filter.archived', 'Arquivadas'],
    ['communities.list.regionArchived', 'Comunidades arquivadas de {tenant}'],
    ['communities.emptyArchived.title', 'Nenhuma comunidade arquivada'],
    [
      'communities.emptyArchived.body',
      'Quando você arquivar uma comunidade, ela aparece aqui para ser reativada.',
    ],
    ['communities.confirm.reactivate.title', 'Reativar comunidade?'],
    [
      'communities.confirm.reactivate.body',
      'Ela volta para a lista de comunidades e pode receber publicações de novo.',
    ],
    ['communities.confirm.reactivate.confirm', 'Reativar'],
    ['communities.confirm.reactivate.cancel', 'Cancelar'],
    ['communities.errors.reactivate', 'Não foi possível reativar a comunidade. Tente novamente.'],
    ['stories.own.actionCommunity', 'Publicar um story em {community}'],
    ['stories.publish.destination.none', 'Nenhuma comunidade'],
    [
      'stories.publish.destination.helper',
      'O story aparece no início por 24 h e continua nos Destaques da comunidade.',
    ],
    ['stories.publish.toastCommunity', 'Story publicado em {community}.'],
    [
      'stories.publish.errors.archived',
      'A comunidade {community} foi arquivada e o story não foi publicado. Escolha outra comunidade ou publique sem comunidade.',
    ],
    ['stories.circle.tenant', 'Abrir stories de {tenant}'],
    ['stories.circle.highlight', 'Abrir destaque {title}'],
    ['stories.highlights.coverAlt', 'Capa do destaque {title}'],
    ['stories.highlights.place.home', 'Início'],
  ])('%s is the UI-SPEC string', (key, expected) => {
    expect(at(key)).toBe(expected);
  });

  it.each([
    ['communities.list.regionArchived', '{tenant}'],
    ['stories.own.actionCommunity', '{community}'],
    ['stories.publish.toastCommunity', '{community}'],
    ['stories.publish.errors.archived', '{community}'],
    ['stories.circle.tenant', '{tenant}'],
    ['stories.circle.highlight', '{title}'],
    ['stories.highlights.coverAlt', '{title}'],
  ])('%s carries the %s placeholder', (key, placeholder) => {
    expect(at(key)).toContain(placeholder);
  });

  it.each([
    ['communities.picker.default', 'Feed principal'],
    ['stories.own.label', 'Seu story'],
    ['communities.archived.pill', 'Arquivada'],
  ])('%s — a word the phase reuses — is not reworded', (key, expected) => {
    expect(at(key)).toBe(expected);
  });
});

describe('scripts/check-ui-literals.sh (UI-SPEC token file rule)', () => {
  function run(files: Record<string, string>): { status: number | null; out: string } {
    const dir = mkdtempSync(path.join(tmpdir(), 'tria-literals-'));
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), body);
    }
    const result = spawnSync('bash', ['scripts/check-ui-literals.sh', dir], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  }

  it('fails on a hex colour literal in a .tsx', () => {
    const r = run({
      'Foo.tsx': 'export const Foo = () => <div style={{ color: "#ff0000" }} />;\n',
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain('Foo.tsx:1');
  });

  it('fails on a legacy prototype brand class', () => {
    const r = run({
      'Foo.tsx': 'export const Foo = () => <button className="btn-gold">x</button>;\n',
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain('btn-gold');
  });

  it('fails on JSX text with pt-BR diacritics outside the catalog', () => {
    const r = run({ 'Foo.tsx': 'export const Foo = () => <p>Configurações</p>;\n' });
    expect(r.status).toBe(1);
    expect(r.out).toContain('Foo.tsx:1');
  });

  it('passes on catalog-driven text, on a .test.tsx and on tokens.css (excluded by extension)', () => {
    const r = run({
      'Foo.tsx': "export const Foo = () => <p>{t('title')}</p>;\n",
      'Foo.test.tsx': 'export const Foo = () => <p>Configurações</p>;\n',
      'styles/tokens.css': ':root { --theme-bg: #f5f7fb; }\n',
    });
    expect(r.out).toBe(r.status === 0 ? r.out : `unexpected failure:\n${r.out}`);
    expect(r.status).toBe(0);
  });
});
