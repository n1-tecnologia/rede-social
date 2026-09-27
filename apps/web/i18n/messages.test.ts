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

/**
 * 05.2-05 — the grouped viewer's three strings (UI-SPEC Copywriting Contract, "Viewer (UI-D-65/66)")
 * and the three placeholders of its live-region template. `viewer.position` is REPLACED by
 * `viewer.positionGroup`, so its absence is pinned too: a key nothing reads is a string nobody
 * reviews.
 */
describe('05.2-05 — the grouped viewer strings and their placeholders', () => {
  const messages = loadMessages(catalogDir) as Record<string, unknown>;

  function lookup(dotted: string): unknown {
    return dotted
      .split('.')
      .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], messages);
  }

  it.each([
    ['stories.viewer.positionGroup', '{group}: story {current} de {total}'],
    ['stories.viewer.loadingGroup', 'Carregando destaque…'],
    ['stories.highlights.errors.load', 'Não foi possível carregar este destaque.'],
  ])('%s is the UI-SPEC string', (key, expected) => {
    expect(lookup(key)).toBe(expected);
  });

  it.each([
    ['stories.viewer.positionGroup', '{group}'],
    ['stories.viewer.positionGroup', '{current}'],
    ['stories.viewer.positionGroup', '{total}'],
  ])('%s carries the %s placeholder', (key, placeholder) => {
    expect(String(lookup(key))).toContain(placeholder);
  });

  it('stories.viewer.position is gone — the group template replaced it', () => {
    expect(lookup('stories.viewer.position')).toBeUndefined();
  });
});

/**
 * 05.2-06 — the highlight sheet's words (UI-SPEC Copywriting Contract: "Checklist sheet (UI-D-67)",
 * "Single-select sheet (UI-D-68)", "Title step", the curation toasts and errors, and the viewer's
 * "Destacar"). Every placeholder is pinned, so a missing brace fails here rather than rendering a
 * raw `{title}` to a curator. `{limit}` is interpolated from `STORY_HIGHLIGHT_MAX_TITLE` /
 * `STORY_HIGHLIGHT_MAX_ITEMS` / `STORY_HIGHLIGHT_MAX_PER_PLACE` (the place-cap copy, review WR-03)
 * and never typed into copy.
 */
describe('05.2-06 — the highlight sheet strings and their placeholders', () => {
  const messages = loadMessages(catalogDir) as Record<string, unknown>;

  function lookup(dotted: string): unknown {
    return dotted
      .split('.')
      .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], messages);
  }

  it.each([
    ['stories.viewer.highlight', 'Destacar'],
    ['stories.highlights.sheet.title', 'Destacar story'],
    [
      'stories.highlights.sheet.helper',
      'Um story em um destaque continua visível depois das 24 h.',
    ],
    ['stories.highlights.sheet.row', 'Destacar em {title}, {place}'],
    ['stories.highlights.sheet.emptyTitle', 'Nenhum destaque ainda.'],
    [
      'stories.highlights.sheet.emptyBody',
      'Crie um destaque no início ou em uma comunidade para guardar este story.',
    ],
    ['stories.highlights.sheet.emptyCta', 'Criar destaque'],
    ['stories.highlights.select.title', 'Destaque'],
    [
      'stories.highlights.select.helper',
      'O story aparece no início por 24 h e continua no destaque escolhido.',
    ],
    ['stories.highlights.select.none', 'Nenhum'],
    ['stories.highlights.select.create', 'Novo destaque'],
    ['stories.highlights.select.row', 'Publicar no destaque {title}, {place}'],
    ['stories.highlights.select.selected', 'Selecionado'],
    ['stories.highlights.create.title', 'Novo destaque'],
    ['stories.highlights.create.place', 'Em {place}'],
    ['stories.highlights.create.label', 'Nome'],
    ['stories.highlights.create.placeholder', 'Ex.: Bastidores'],
    ['stories.highlights.create.counter', '{count}/{limit}'],
    ['stories.highlights.create.back', 'Voltar'],
    [
      'stories.highlights.create.composerHelper',
      'O destaque é criado junto com o story, quando você publicar.',
    ],
    ['stories.highlights.create.submit', 'Criar destaque'],
    ['stories.highlights.create.submitting', 'Criando…'],
    ['stories.highlights.errors.titleEmpty', 'Dê um nome para o destaque.'],
    ['stories.highlights.errors.generic', 'Não foi possível salvar. Tente novamente.'],
    [
      'stories.highlights.errors.archived',
      'Esta comunidade foi arquivada. Não é possível adicionar stories aos destaques dela.',
    ],
    [
      'stories.highlights.errors.full',
      'Este destaque chegou ao limite de {limit} stories. Remova um para adicionar outro.',
    ],
    [
      'stories.highlights.errors.placeFull',
      'Este lugar chegou ao limite de {limit} destaques. Exclua um para criar outro.',
    ],
    ['stories.highlights.toasts.added', 'Story adicionado ao destaque.'],
    ['stories.highlights.toasts.removed', 'Story removido do destaque.'],
  ])('%s is the UI-SPEC string', (key, expected) => {
    expect(lookup(key)).toBe(expected);
  });

  it.each([
    ['stories.highlights.sheet.row', '{title}'],
    ['stories.highlights.sheet.row', '{place}'],
    ['stories.highlights.select.row', '{title}'],
    ['stories.highlights.select.row', '{place}'],
    ['stories.highlights.create.place', '{place}'],
    ['stories.highlights.create.counter', '{count}'],
    ['stories.highlights.create.counter', '{limit}'],
    ['stories.highlights.errors.full', '{limit}'],
    ['stories.highlights.errors.placeFull', '{limit}'],
  ])('%s carries the %s placeholder', (key, placeholder) => {
    expect(String(lookup(key))).toContain(placeholder);
  });

  it('no limit is typed into copy — 15, 100 and 50 arrive from the contracts', () => {
    expect(String(lookup('stories.highlights.create.counter'))).not.toMatch(/\d/);
    expect(String(lookup('stories.highlights.errors.full'))).not.toMatch(/\d/);
    expect(String(lookup('stories.highlights.errors.placeFull'))).not.toMatch(/\d/);
  });
});

/**
 * 05.2-07 — "Seus stories" after pins (UI-D-77, UI-D-78, UI-D-79). The history's indicator and menu
 * speak of highlights, the delete dialog names them with action-named buttons, and the pin
 * vocabulary is RETIRED: `stories.pin.*`, `stories.history.pinned` and `stories.history.menu.pin` are
 * pinned ABSENT, so a stray re-add of "Fixar" fails here.
 */
describe('05.2-07 — the "Seus stories" strings, and the pin vocabulary retired', () => {
  const messages = loadMessages(catalogDir) as Record<string, unknown>;

  function lookup(dotted: string): unknown {
    return dotted
      .split('.')
      .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], messages);
  }

  it.each([
    ['stories.history.highlighted', '{count, plural, one {Em # destaque} other {Em # destaques}}'],
    ['stories.history.menu.highlight', 'Destacar'],
    ['stories.history.confirmDelete.title', 'Excluir story?'],
    ['stories.history.confirmDelete.body', 'Ele sai do início e de todos os destaques onde está.'],
    ['stories.history.confirmDelete.confirm', 'Excluir story'],
    ['stories.history.confirmDelete.cancel', 'Manter story'],
  ])('%s is the UI-SPEC string', (key, expected) => {
    expect(lookup(key)).toBe(expected);
  });

  it('stories.history.highlighted carries the {count} plural', () => {
    expect(String(lookup('stories.history.highlighted'))).toContain('{count, plural,');
  });

  it.each(['stories.pin', 'stories.history.pinned', 'stories.history.menu.pin'])(
    '%s is gone — "fixar" is retired (UI-D-79)',
    (key) => {
      expect(lookup(key)).toBeUndefined();
    },
  );

  it('no string under stories.history says "Fixar" or "fixado"', () => {
    expect(JSON.stringify(lookup('stories.history'))).not.toMatch(/[Ff]ixa/);
  });
});

/**
 * 05.2-08 — the composer's "Destaque" row (UI-D-69), its landings (UI-D-70) and refusals (UI-D-71).
 * 05.1's "Publicar em" words are retired with the row: `publish.toastCommunity` and
 * `publish.destination.helper` are pinned ABSENT, and `destination.none` / `errors.archived` are
 * pinned to their rewording, so a key nothing reads cannot linger unreviewed.
 */
describe('05.2-08 — the composer "Destaque" strings, and the "Publicar em" words retired', () => {
  const messages = loadMessages(catalogDir) as Record<string, unknown>;

  function lookup(dotted: string): unknown {
    return dotted
      .split('.')
      .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], messages);
  }

  it.each([
    ['stories.publish.destination.label', 'Destaque'],
    ['stories.publish.destination.none', 'Nenhum'],
    ['stories.publish.destination.value', '{place} · {title}'],
    ['stories.publish.destination.choose', 'Escolher destaque'],
    ['stories.publish.toast', 'Story publicado.'],
    ['stories.publish.toastHighlight', 'Story publicado no destaque {title}.'],
    [
      'stories.publish.toastHighlightCommunity',
      'Story publicado no destaque {title} de {community}.',
    ],
    [
      'stories.publish.errors.archived',
      'A comunidade {community} foi arquivada e o story não foi publicado. Escolha outro destaque ou publique sem destaque.',
    ],
    [
      'stories.publish.errors.titleInvalid',
      'O nome do destaque precisa ter de 1 a {limit} caracteres. Escolha o destaque de novo.',
    ],
  ])('%s is the UI-SPEC string', (key, expected) => {
    expect(lookup(key)).toBe(expected);
  });

  it.each([
    ['stories.publish.destination.value', '{place}'],
    ['stories.publish.destination.value', '{title}'],
    ['stories.publish.toastHighlight', '{title}'],
    ['stories.publish.toastHighlightCommunity', '{title}'],
    ['stories.publish.toastHighlightCommunity', '{community}'],
    ['stories.publish.errors.archived', '{community}'],
    ['stories.publish.errors.titleInvalid', '{limit}'],
  ])('%s carries the %s placeholder', (key, placeholder) => {
    expect(String(lookup(key))).toContain(placeholder);
  });

  it('the title rule interpolates the limit — no digit is typed into it (UI-D-05)', () => {
    expect(String(lookup('stories.publish.errors.titleInvalid'))).not.toMatch(/\b15\b/);
  });

  it.each(['stories.publish.toastCommunity', 'stories.publish.destination.helper'])(
    '%s is gone — the "Publicar em" row is retired',
    (key) => {
      expect(lookup(key)).toBeUndefined();
    },
  );

  it('no string under stories.publish says "Nenhuma comunidade"', () => {
    expect(JSON.stringify(lookup('stories.publish'))).not.toContain('Nenhuma comunidade');
  });
});

/**
 * 05.2-09 — the manage screen, the edit sheet, the cover step, the picker, the delete confirm, the
 * curation toasts and errors, and the admin circles (UI-SPEC Copywriting Contract). Every
 * placeholder is pinned, so a missing brace fails here rather than rendering a raw `{title}`.
 */
describe('05.2-09 — the manage screen strings and their placeholders', () => {
  const messages = loadMessages(catalogDir) as Record<string, unknown>;

  function lookup(dotted: string): unknown {
    return dotted
      .split('.')
      .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], messages);
  }

  it.each([
    ['stories.highlights.manage.create', 'Novo destaque'],
    ['stories.highlights.manage.titleHome', 'Destaques do início'],
    ['stories.highlights.manage.titleCommunity', 'Destaques de {community}'],
    ['stories.highlights.manage.back', 'Voltar'],
    ['stories.highlights.manage.region', 'Destaques em ordem'],
    ['stories.highlights.manage.helper', 'Arraste para mudar a ordem. É a mesma ordem da fileira.'],
    ['stories.highlights.manage.count', '{count, plural, one {# story} other {# stories}}'],
    ['stories.highlights.manage.emptyItem', 'Vazio · só você vê'],
    ['stories.highlights.manage.edit', 'Editar destaque {title}'],
    ['stories.highlights.manage.drag', 'Mover {title}'],
    [
      'stories.highlights.manage.dragHint',
      'Use as setas para cima e para baixo para mudar a posição.',
    ],
    ['stories.highlights.manage.moved', '{title} agora está na posição {position} de {total}.'],
    [
      'stories.highlights.manage.archivedNote',
      'Esta comunidade foi arquivada. Você ainda pode remover stories e excluir destaques.',
    ],
    ['stories.highlights.empty.title', 'Nenhum destaque ainda'],
    [
      'stories.highlights.empty.bodyHome',
      'Crie um destaque para manter stories no início depois das 24 h.',
    ],
    [
      'stories.highlights.empty.bodyCommunity',
      'Crie um destaque para manter stories nesta comunidade depois das 24 h.',
    ],
    ['stories.highlights.edit.title', 'Editar destaque'],
    ['stories.highlights.edit.cover', 'Capa'],
    ['stories.highlights.edit.changeCover', 'Trocar capa'],
    ['stories.highlights.edit.name', 'Nome'],
    ['stories.highlights.edit.position', 'Posição {position} de {total}'],
    ['stories.highlights.edit.moveUp', 'Mover para cima'],
    ['stories.highlights.edit.moveDown', 'Mover para baixo'],
    ['stories.highlights.edit.stories', 'Stories neste destaque'],
    ['stories.highlights.edit.coverPill', 'Capa'],
    ['stories.highlights.edit.remove', 'Remover do destaque o story de {date}'],
    ['stories.highlights.edit.addStories', 'Adicionar stories'],
    ['stories.highlights.edit.delete', 'Excluir destaque'],
    ['stories.highlights.edit.emptyTitle', 'Nenhum story neste destaque'],
    [
      'stories.highlights.edit.emptyBody',
      'Só você vê este destaque. Ele aparece para os membros quando tiver um story.',
    ],
    [
      'stories.highlights.edit.archivedNote',
      'Esta comunidade foi arquivada. Não é possível mudar a capa, o nome ou adicionar stories.',
    ],
    ['stories.highlights.edit.saveName', 'Salvar nome'],
    ['stories.highlights.edit.savingName', 'Salvando…'],
    ['stories.highlights.cover.title', 'Escolher capa'],
    ['stories.highlights.cover.upload', 'Enviar imagem'],
    ['stories.highlights.cover.option', 'Usar o story de {date} como capa'],
    ['stories.highlights.cover.current', 'Capa atual'],
    ['stories.highlights.cover.auto', 'Usar capa automática'],
    [
      'stories.highlights.cover.autoHelper',
      'Sem uma capa escolhida, usamos o story adicionado por último.',
    ],
    [
      'stories.highlights.cover.noImages',
      'Este destaque ainda não tem stories com foto. Envie uma imagem para a capa.',
    ],
    ['stories.highlights.picker.title', 'Adicionar stories'],
    ['stories.highlights.picker.helper', 'Stories expirados também podem entrar em um destaque.'],
    ['stories.highlights.picker.row', 'Adicionar ao destaque o story de {date}'],
    ['stories.highlights.picker.empty', 'Você ainda não publicou nenhum story.'],
    ['stories.highlights.confirmDelete.title', 'Excluir destaque?'],
    [
      'stories.highlights.confirmDelete.body',
      'O destaque {title} sai da fileira para todos. Os stories continuam em Seus stories.',
    ],
    ['stories.highlights.confirmDelete.confirm', 'Excluir destaque'],
    ['stories.highlights.confirmDelete.cancel', 'Manter destaque'],
    ['stories.highlights.toasts.created', 'Destaque criado.'],
    ['stories.highlights.toasts.renamed', 'Nome salvo.'],
    ['stories.highlights.toasts.coverChanged', 'Capa atualizada.'],
    ['stories.highlights.toasts.deleted', 'Destaque excluído.'],
    ['stories.highlights.errors.order', 'Não foi possível salvar a nova ordem. Tente novamente.'],
    [
      'stories.highlights.errors.orderStale',
      'A lista de destaques mudou. Confira a ordem e tente de novo.',
    ],
    ['stories.highlights.circle.label', 'Gerenciar'],
    ['stories.highlights.circle.actionHome', 'Gerenciar destaques do início'],
    ['stories.highlights.circle.actionCommunity', 'Gerenciar destaques de {community}'],
    ['stories.circle.highlightEmpty', 'Editar destaque {title}. Vazio, só você vê.'],
  ])('%s is the UI-SPEC string', (key, expected) => {
    expect(lookup(key)).toBe(expected);
  });

  it.each([
    ['stories.highlights.manage.titleCommunity', '{community}'],
    ['stories.highlights.manage.count', '{count, plural,'],
    ['stories.highlights.manage.edit', '{title}'],
    ['stories.highlights.manage.drag', '{title}'],
    ['stories.highlights.manage.moved', '{title}'],
    ['stories.highlights.manage.moved', '{position}'],
    ['stories.highlights.manage.moved', '{total}'],
    ['stories.highlights.edit.position', '{position}'],
    ['stories.highlights.edit.position', '{total}'],
    ['stories.highlights.edit.remove', '{date}'],
    ['stories.highlights.cover.option', '{date}'],
    ['stories.highlights.picker.row', '{date}'],
    ['stories.highlights.confirmDelete.body', '{title}'],
    ['stories.highlights.circle.actionCommunity', '{community}'],
    ['stories.circle.highlightEmpty', '{title}'],
  ])('%s carries the %s placeholder', (key, placeholder) => {
    expect(String(lookup(key))).toContain(placeholder);
  });
});

/**
 * 05.2-10 — the tenant circle's seen state carried in its NAME (UI-D-61, WCAG 1.4.1): the ring's
 * colour is never the only signal. `{tenant}` is pinned so a missing brace fails here rather than
 * reading a raw placeholder to a screen-reader user.
 */
describe('05.2-10 — the seen ring’s accessible names', () => {
  const messages = loadMessages(catalogDir) as Record<string, unknown>;

  function lookup(dotted: string): unknown {
    return dotted
      .split('.')
      .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], messages);
  }

  it.each([
    ['stories.circle.tenant', 'Abrir stories de {tenant}'],
    ['stories.circle.tenantUnseen', 'Abrir stories de {tenant}. Há stories novos.'],
  ])('%s is the UI-SPEC string', (key, expected) => {
    expect(lookup(key)).toBe(expected);
  });

  it('stories.circle.tenantUnseen carries the {tenant} placeholder', () => {
    expect(String(lookup('stories.circle.tenantUnseen'))).toContain('{tenant}');
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

/**
 * 05.3-08 — the `reels` catalog (UI-SPEC Copywriting Contract). One root key, the tab label the
 * shell's `<key>.nav` resolver reads (D-123), and the four interpolations the client fills: a
 * deleted brace would not fail typecheck — the call site would pass a value nobody reads — so it
 * fails here instead.
 */
describe('05.3-08 — the reels catalog and its placeholders', () => {
  const messages = loadMessages(catalogDir) as Record<string, unknown>;

  function lookup(dotted: string): unknown {
    return dotted
      .split('.')
      .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], messages);
  }

  it.each([
    ['reels.nav', 'Reels'],
    ['reels.region', 'Reels'],
    ['reels.lanes.label', 'Filtrar vídeos por comunidade'],
    ['reels.lanes.all', 'Todos'],
    ['reels.sound.unmute', 'Ativar som'],
    ['reels.sound.mute', 'Silenciar'],
    ['reels.play', 'Reproduzir vídeo'],
    ['reels.pause', 'Pausar vídeo'],
    ['reels.caption.less', 'menos'],
    ['reels.previous', 'Vídeo anterior'],
    ['reels.next', 'Próximo vídeo'],
    ['reels.empty.title', 'Nenhum vídeo ainda'],
    ['reels.errors.load', 'Não foi possível carregar os vídeos.'],
    ['reels.errors.retry', 'Tentar novamente'],
    ['reels.errors.playback', 'Não foi possível reproduzir este vídeo.'],
    ['reels.errors.loadMore', 'Não foi possível carregar mais vídeos.'],
  ])('%s is the UI-SPEC string', (key, expected) => {
    expect(lookup(key)).toBe(expected);
  });

  it.each([
    ['reels.rail.author', ['{name}']],
    ['reels.empty.body', ['{tenant}']],
    ['reels.position', ['{current}', '{author}']],
  ])('%s carries its placeholders', (key, placeholders) => {
    const value = String(lookup(key));
    for (const placeholder of placeholders) expect(value).toContain(placeholder);
  });

  it('reuses the feed strings instead of copying them (like, share, caption.more, empty.cta)', () => {
    const reels = lookup('reels') as Record<string, unknown>;
    expect(Object.keys(reels)).not.toContain('actions');
    expect(Object.keys(reels)).not.toContain('meta');
    expect(Object.keys(reels)).not.toContain('share');
    expect(lookup('reels.caption.more')).toBeUndefined();
    expect(lookup('reels.empty.cta')).toBeUndefined();
  });
});

/**
 * 06-01 — the `events` catalog's list strings (UI-SPEC Copywriting Contract, "List, poster and
 * Início"). A deleted brace would not fail typecheck — the call site would pass a value nobody reads
 * — so each placeholder is pinned here, and the ICU plural is FORMATTED, not just read.
 */
describe('06 — events list strings and placeholders', () => {
  const messages = loadMessages(catalogDir) as Record<string, unknown>;

  function lookup(dotted: string): unknown {
    return dotted
      .split('.')
      .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], messages);
  }

  it.each([
    ['events.nav', 'Eventos'],
    ['events.list.title', 'Eventos'],
    ['events.list.subtitle', 'Confirme presença e faça check-in no dia.'],
    ['events.list.filter.label', 'Filtrar eventos'],
    ['events.list.filter.upcoming', 'Próximos'],
    ['events.list.filter.past', 'Passados'],
    ['events.state.cancelled', 'Cancelado'],
    ['events.state.ended', 'Encerrado'],
    ['events.when.now', 'Agora'],
    ['events.when.today', 'Hoje'],
    ['events.when.tomorrow', 'Amanhã'],
    ['events.place.online', 'Online'],
    ['events.empty.upcoming.title', 'Nada por aqui ainda'],
    ['events.empty.past.title', 'Nenhum evento passado'],
    ['events.empty.past.body', 'Os eventos que já aconteceram ficam guardados aqui.'],
    ['events.errors.loadMore', 'Não foi possível carregar mais eventos.'],
    ['events.errors.retry', 'Tentar novamente'],
  ])('%s is the UI-SPEC string', (key, expected) => {
    expect(lookup(key)).toBe(expected);
  });

  it.each([
    ['events.list.regionUpcoming', ['{tenant}']],
    ['events.list.regionPast', ['{tenant}']],
    ['events.empty.upcoming.body', ['{tenant}']],
    ['events.poster.label', ['{title}', '{when}']],
    ['events.cover.alt', ['{title}']],
    ['events.when.at', ['{date}', '{time}']],
    ['events.when.liveUntil', ['{time}']],
    ['events.when.range', ['{start}', '{end}']],
    ['events.when.inDays', ['{count, plural']],
  ])('%s carries its placeholders', (key, placeholders) => {
    const value = String(lookup(key));
    for (const placeholder of placeholders) expect(value).toContain(placeholder);
  });

  it('events.when.inDays is an ICU plural: "Em 1 dia" / "Em 5 dias"', async () => {
    const { createTranslator } = await import('next-intl');
    // The catalog is loaded as an untyped tree, so the translator is narrowed to the call shape.
    const t = createTranslator({ locale: 'pt-BR', messages, namespace: 'events' }) as unknown as (
      key: string,
      values?: Record<string, string | number>,
    ) => string;
    expect(t('when.inDays', { count: 1 })).toBe('Em 1 dia');
    expect(t('when.inDays', { count: 5 })).toBe('Em 5 dias');
    expect(t('poster.label', { title: 'Encontro', when: 'seg., 12 de out. · 19:00' })).toBe(
      'Encontro, seg., 12 de out. · 19:00',
    );
  });
});
