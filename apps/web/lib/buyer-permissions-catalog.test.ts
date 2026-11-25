import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages, type MessageTree } from '../i18n/messages';

/**
 * 11.1-10 task 3 (UI-D-882, UI-D-897, BPERM-24): every new string of the buyer-permissions phase is in
 * a host catalog, verbatim from the UI-SPEC Copywriting Contract (NFC-normalised), non-empty, with its
 * placeholder where the contract puts it, beside the shipped keys without shadowing any, and the
 * member-readable ones name nothing (no product, purchase, permission, refund, entitlement or flag).
 */

const catalogDir = join(process.cwd(), 'messages', 'pt-BR');
const messages = loadMessages(catalogDir) as MessageTree;

function at(path: string): unknown {
  let node: unknown = messages;
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as MessageTree)[part];
  }
  return node;
}

const nfc = (text: string) => text.normalize('NFC');

/** The catalog is untyped here (a test of its shape), so the translator takes any key and string values. */
const translator = () =>
  createTranslator({ locale: 'pt-BR', messages }) as unknown as (
    key: string,
    values?: Record<string, string>,
  ) => string;

/** [catalog key, the UI-SPEC sentence], in the order the Copywriting Contract lists them. */
const ADMIN_ROWS: [string, string][] = [
  ['store.form.communities.permissions.legend', 'Quem comprar pode:'],
  ['store.form.communities.permissions.legendCommunity', ' em {community}'],
  ['store.form.communities.permissions.like', 'Curtir'],
  ['store.form.communities.permissions.comment', 'Comentar'],
  ['store.form.communities.permissions.share', 'Compartilhar'],
  ['store.form.communities.permissions.post', 'Postar na comunidade'],
  ['store.form.communities.permissions.story', 'Postar story'],
  [
    'store.form.communities.permissions.helper',
    'As permissões valem para quem já tem o produto e mudam assim que você salvar. Quem tiver mais de um produto da mesma comunidade soma as permissões.',
  ],
  [
    'store.form.communities.permissions.socialOff',
    'Postar na comunidade e Postar story só funcionam com a Rede social ligada.',
  ],
  [
    'store.form.communities.permissions.noOpenHighlight',
    'Nenhum destaque desta comunidade está aberto a compradores. Abra um na tela de destaques da comunidade para o story funcionar.',
  ],
  ['stories.highlights.edit.openToBuyers.label', 'Aberto a compradores'],
  [
    'stories.highlights.edit.openToBuyers.helper',
    'Quem comprou um produto com a permissão de postar story pode salvar os próprios stories neste destaque. Todos os membros da comunidade veem os stories salvos. Se você fechar, os stories que já foram salvos continuam aqui até você removê-los.',
  ],
  [
    'stories.highlights.edit.openToBuyers.socialOff',
    'Compradores só salvam stories com a Rede social ligada.',
  ],
  ['stories.highlights.edit.openToBuyers.toastOn', 'Destaque aberto a compradores.'],
  ['stories.highlights.edit.openToBuyers.toastOff', 'Destaque fechado a compradores.'],
  ['stories.highlights.manage.openPill', 'Compradores'],
  ['stories.highlights.manage.openPillPrefix', 'Aberto a '],
];

const MEMBER_ROWS: [string, string][] = [
  ['feed.comments.emptyReadOnly', 'Nenhum comentário ainda.'],
  ['feed.composer.member.errors.communityForbidden', 'Você não pode publicar nesta comunidade.'],
];

const ALL_ROWS = [...ADMIN_ROWS, ...MEMBER_ROWS];

describe('11.1-10 — the new keys read exactly as the Copywriting Contract (UI-D-897)', () => {
  it.each(ALL_ROWS)('%s', (key, sentence) => {
    const value = at(key);
    expect(typeof value).toBe('string');
    expect(nfc(value as string)).toBe(nfc(sentence));
  });

  it('refuses an empty or whitespace-only value for any new key, other than the two contract-spaced ones', () => {
    for (const [key] of ALL_ROWS) {
      expect((at(key) as string).trim().length, key).toBeGreaterThan(0);
    }
  });

  it('keeps the {community} placeholder only where the contract has it', () => {
    const withPlaceholder = ALL_ROWS.filter(([, sentence]) => sentence.includes('{community}')).map(
      ([key]) => key,
    );
    expect(withPlaceholder).toEqual(['store.form.communities.permissions.legendCommunity']);
    for (const [key] of ALL_ROWS) {
      const braces = (at(key) as string).match(/\{[^}]*\}/g) ?? [];
      expect(braces, key).toEqual(key.endsWith('legendCommunity') ? ['{community}'] : []);
    }
  });

  it('renders the legend suffix with a name, and with an empty name leaves no brace', () => {
    const t = translator();
    expect(
      t('store.form.communities.permissions.legendCommunity', { community: 'Turma Ouro' }),
    ).toBe(' em Turma Ouro');
    expect(t('store.form.communities.permissions.legendCommunity', { community: '' })).toBe(' em ');
  });

  it('a community name is text: braces and markup in it are not interpreted by the catalog', () => {
    const t = translator();
    const name = '<b>{x}</b>';
    expect(t('store.form.communities.permissions.legendCommunity', { community: name })).toBe(
      ` em ${name}`,
    );
  });
});

describe('11.1-10 — adjacency: the new subtree sits beside the shipped keys without shadowing any (BPERM-24)', () => {
  const communities = at('store.form.communities') as MessageTree;

  it('keeps every shipped form.communities string and adds one subtree, permissions', () => {
    for (const key of ['label', 'choose', 'change', 'remove', 'none', 'helper']) {
      expect(typeof communities[key], key).toBe('string');
    }
    expect(typeof communities.permissions).toBe('object');
    expect(Object.keys(communities)).toEqual([
      'label',
      'choose',
      'change',
      'remove',
      'none',
      'helper',
      'permissions',
    ]);
  });

  it('holds exactly the ten contract keys inside the subtree, in the contract order', () => {
    expect(Object.keys(communities.permissions as MessageTree)).toEqual([
      'legend',
      'legendCommunity',
      'like',
      'comment',
      'share',
      'post',
      'story',
      'helper',
      'socialOff',
      'noOpenHighlight',
    ]);
  });

  it('is no key both a string and a subtree on any path of the new keys', () => {
    for (const [key] of ALL_ROWS) {
      const parts = key.split('.');
      let node: unknown = messages;
      for (const part of parts.slice(0, -1)) {
        node = (node as MessageTree)[part];
        expect(typeof node, `${key}: ${part}`).toBe('object');
      }
    }
  });

  it('the stories catalog keeps its shipped highlights.edit and highlights.manage keys', () => {
    expect(at('stories.highlights.edit.title')).toBeTypeOf('string');
    expect(at('stories.highlights.edit.addStories')).toBeTypeOf('string');
    expect(at('stories.highlights.manage.archivedNote')).toBeTypeOf('string');
    expect(at('stories.highlights.errors.generic')).toBeTypeOf('string');
    expect(at('feed.comments.empty')).toBe('Nenhum comentário ainda. Seja o primeiro!');
    expect(at('feed.composer.audienceCommunity')).toBe(
      'Todos os membros veem esta publicação na comunidade {community}.',
    );
  });

  it('appends the new keys last in their subtree: the shipped order is untouched', () => {
    const edit = Object.keys(at('stories.highlights.edit') as MessageTree);
    expect(edit.at(-1)).toBe('openToBuyers');
    expect(edit.slice(0, 17)).toEqual([
      'title',
      'cover',
      'changeCover',
      'name',
      'position',
      'moveUp',
      'moveDown',
      'stories',
      'coverPill',
      'remove',
      'addStories',
      'delete',
      'emptyTitle',
      'emptyBody',
      'archivedNote',
      'saveName',
      'savingName',
    ]);
    const manage = Object.keys(at('stories.highlights.manage') as MessageTree);
    expect(manage.slice(-2)).toEqual(['openPill', 'openPillPrefix']);
    const comments = Object.keys(at('feed.comments') as MessageTree);
    expect(comments.at(-1)).toBe('emptyReadOnly');
  });

  it('keeps each catalog file as parseable UTF-8 JSON whose root equals the file prefix', () => {
    for (const file of ['store.json', 'stories.json', 'feed.json']) {
      const parsed = JSON.parse(readFileSync(join(catalogDir, file), 'utf8')) as Record<
        string,
        unknown
      >;
      expect(Object.keys(parsed)).toEqual([file.slice(0, file.indexOf('.'))]);
    }
  });
});

describe('11.1-10 — the neutrality rule: a member-readable string names nothing (UI-D-882, T-11.1-37)', () => {
  const FORBIDDEN =
    /\b(produtos?|compra\w*|compr(ou|ei|ar)|comprador\w*|permiss\w+|permitid\w+|liberad\w+|reembols\w+|entitlements?)\b/;
  const FLAG_NAMES =
    /\b(curtir|comentar|compartilhar|postar|like|comment|share|post|story|stories)\b/;
  const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  it.each(MEMBER_ROWS)(
    '%s names no product, purchase, permission, refund, entitlement or flag',
    (key) => {
      const text = fold(at(key) as string);
      expect(text).not.toMatch(FORBIDDEN);
      expect(text).not.toMatch(FLAG_NAMES);
    },
  );

  it('the guard is not vacuous: the administrator-side copy it would refuse does trip it', () => {
    for (const [key] of ADMIN_ROWS.filter(([k]) =>
      /helper|noOpenHighlight|label|legend$/.test(k),
    )) {
      const text = fold(at(key) as string);
      expect(FORBIDDEN.test(text) || FLAG_NAMES.test(text), key).toBe(true);
    }
  });
});
