import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages, type MessageTree } from './messages';

/**
 * Phase 11-18 (UI-D-860, UI-D-880; CHAT-06, CHAT-07, MODER-04, MODER-05) — every new pt-BR sentence of the
 * Copywriting Contract, pinned: the exact key set of each new subtree, every sentence verbatim (the pt-BR
 * strings ARE the contract), every placeholder, every ICU plural through the real next-intl formatter, and
 * the forbidden-word scan of UI-D-860 by audience.
 *
 * `safety.json` also carries the Phase 13 report and block copy (UI-D-632 to UI-D-638 of
 * `13-UI-SPEC-ADDENDUM.md`, "reused unchanged"), because plan 13-20 never executed.
 *
 * Real merged catalog, real formatter, read-only: nothing here writes, so two parallel runs cannot change
 * each other's result.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

/** Every leaf of the whole catalog as `root.dotted.path -> string`. */
function leaves(tree: MessageTree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, leaves(value, path));
  }
  return out;
}

const all = leaves(messages);

/** The names a message interpolates: `{name}` and `{name, plural, …}`, plus `<b>` tags, never the text inside a form. */
function placeholders(text: string): string[] {
  return [
    ...new Set([...text.matchAll(/\{(\w+)(?:,|\})/g)].map((match) => match[1] as string)),
  ].sort();
}

const t = createTranslator({ locale: 'pt-BR', messages }) as unknown as (
  key: string,
  values?: Record<string, unknown>,
) => string;

type Copy = { text: string; names: string[] };
const copy = (text: string, ...names: string[]): Copy => ({ text, names: [...names].sort() });

const PLURAL_BADGE =
  'Conversas, {count, plural, one {# conversa com mensagem nova} other {# conversas com mensagem nova}}';
const PLURAL_ROW =
  '{name}, {count, plural, one {# mensagem nova} other {# mensagens novas}}. {preview}';
const BLOCK_SOCIAL_OFF =
  'Você deixa de ver as publicações e os comentários de {nome}. {nome} não é avisado. Você pode desbloquear em Configurações.';
const BLOCK_SOCIAL_ON =
  'Você deixa de ver as publicações e os comentários de {nome}. {nome} não pode mais seguir você nem escrever para você, e vocês dois deixam de se seguir. {nome} não é avisado. Você pode desbloquear em Configurações.';

/** Conversas and the conversation (UI-D-861 to UI-D-866; `chat.json`). */
const CHAT: Record<string, Copy> = {
  'chat.navConversations': copy('Conversas'),
  'chat.navConversationsBadge': copy(PLURAL_BADGE, 'count'),
  'chat.conversations.title': copy('Conversas'),
  'chat.conversations.region': copy('Suas conversas'),
  'chat.conversations.support.name': copy('Equipe {tenant}', 'tenant'),
  'chat.conversations.support.idle': copy('Fale com a equipe de {tenant}', 'tenant'),
  'chat.conversations.prefix.own': copy('Você: '),
  'chat.conversations.prefix.team': copy('Equipe: '),
  'chat.conversations.row.label': copy(PLURAL_ROW, 'count', 'name', 'preview'),
  'chat.conversations.row.labelRead': copy('{name}. {preview}', 'name', 'preview'),
  'chat.conversations.row.supportLabel': copy('{name}. {preview}', 'name', 'preview'),
  'chat.conversations.row.supportLabelUnread': copy(
    '{name}. {preview}, mensagem nova',
    'name',
    'preview',
  ),
  'chat.conversations.empty.title': copy('Você ainda não conversou com outros membros'),
  'chat.conversations.empty.body': copy('Abra o perfil de um membro e toque em Enviar mensagem.'),
  'chat.conversations.empty.cta': copy('Encontrar pessoas'),
  'chat.conversations.error.title': copy('Não foi possível carregar suas conversas.'),
  'chat.conversations.error.body': copy('Verifique sua conexão e tente de novo.'),
  'chat.conversations.error.retry': copy('Tentar novamente'),
  'chat.conversations.error.more': copy('Não foi possível carregar mais conversas.'),
  'chat.direct.removedName': copy('Membro removido'),
  'chat.direct.empty.title': copy('Escreva para {nome}', 'nome'),
  'chat.direct.empty.body': copy('A conversa aparece na sua lista depois da primeira mensagem.'),
  'chat.direct.composer.placeholder': copy('Escreva uma mensagem'),
  'chat.direct.closed': copy('Esta conversa não aceita novas mensagens.'),
  'chat.direct.blocker.text': copy('Você bloqueou {nome}', 'nome'),
  'chat.direct.blocker.unblock': copy('Desbloquear'),
  'chat.direct.blocker.unblocking': copy('Desbloqueando…'),
  'chat.direct.blocker.unblocked': copy('{nome} foi desbloqueado.', 'nome'),
  'chat.direct.removed': copy(
    'Este membro não está mais na comunidade. A conversa fica só para leitura.',
  ),
  'chat.direct.notFound.title': copy('Conversa não encontrada'),
  'chat.direct.notFound.body': copy('Este link não existe mais ou não é de {tenant}.', 'tenant'),
  'chat.direct.notFound.cta': copy('Voltar para Conversas'),
  'chat.direct.menu.trigger': copy('Mais ações da mensagem'),
  'chat.direct.menu.title': copy('Opções da mensagem'),
  'chat.direct.menu.report': copy('Denunciar mensagem'),
  'chat.direct.menu.block': copy('Bloquear {nome}', 'nome'),
};

/** The profile zone and the directory row (UI-D-867, UI-D-868; `social.json`). */
const SOCIAL: Record<string, Copy> = {
  'social.profile.message': copy('Enviar mensagem'),
  'social.profile.messageAria': copy('Enviar mensagem para {nome}', 'nome'),
  'social.profile.unblock': copy('Desbloquear'),
  'social.profile.unblockAria': copy('Desbloquear {nome}', 'nome'),
  'social.profile.unblocking': copy('Desbloqueando…'),
  'social.profile.unblocked': copy('{nome} foi desbloqueado.', 'nome'),
  'social.directory.messageAria': copy('Enviar mensagem para {nome}', 'nome'),
};

/** The two new bell rows (UI-D-875; `notifications.json`). */
const NOTIFICATIONS: Record<string, Copy> = {
  'notifications.kinds.socialFollowed': copy('<b>{actor}</b> começou a te seguir.', 'actor'),
  'notifications.kinds.moderationReport': copy('<b>Nova denúncia</b> para analisar.'),
};

/** The resolve rows and the archive dialog (UI-D-874; `moderation.json`). */
const MODERATION: Record<string, Copy> = {
  'moderation.report.resolve.dismiss': copy('Ignorar denúncia'),
  'moderation.report.resolve.remove': copy('Remover conteúdo'),
  'moderation.report.resolve.archive': copy('Arquivar comunidade'),
  'moderation.report.resolve.block': copy('Bloquear autor'),
  'moderation.report.resolve.helperMessage': copy('Uma mensagem enviada não pode ser removida.'),
  'moderation.report.archiveDialog.title': copy('Arquivar comunidade?'),
  'moderation.report.archiveDialog.body': copy(
    'Ela sai da lista e ninguém mais publica nela. A pessoa que criou não é avisada. A ação fica registrada no histórico de moderação.',
  ),
  'moderation.report.archiveDialog.confirm': copy('Arquivar'),
  'moderation.report.archiveDialog.cancel': copy('Manter comunidade'),
};

/** Report and block (UI-D-869 to UI-D-872, the queue UI-D-873) and the Phase 13 copy `safety.json` now owns. */
const SAFETY: Record<string, Copy> = {
  'safety.menu.storyTitle': copy('Opções do story'),
  'safety.menu.communityTitle': copy('Opções da comunidade'),
  'safety.menu.messageTitle': copy('Opções da mensagem'),
  'safety.menu.reportPost': copy('Denunciar publicação'),
  'safety.menu.reportComment': copy('Denunciar comentário'),
  'safety.menu.reportStory': copy('Denunciar story'),
  'safety.menu.reportCommunity': copy('Denunciar comunidade'),
  'safety.menu.reportMessage': copy('Denunciar mensagem'),
  'safety.menu.block': copy('Bloquear {nome}', 'nome'),
  'safety.menu.communityTrigger': copy('Mais opções da comunidade'),
  'safety.menu.commentTrigger': copy('Mais ações do comentário'),
  'safety.subject.feedPost.pill': copy('Publicação'),
  'safety.subject.feedPost.title': copy('Denunciar publicação'),
  'safety.subject.postComment.pill': copy('Comentário'),
  'safety.subject.postComment.title': copy('Denunciar comentário'),
  'safety.subject.story.pill': copy('Story'),
  'safety.subject.story.title': copy('Denunciar story'),
  'safety.subject.storyComment.pill': copy('Comentário de story'),
  'safety.subject.storyComment.title': copy('Denunciar comentário'),
  'safety.subject.community.pill': copy('Comunidade'),
  'safety.subject.community.title': copy('Denunciar comunidade'),
  'safety.subject.directMessage.pill': copy('Mensagem'),
  'safety.subject.directMessage.title': copy('Denunciar mensagem'),
  'safety.subject.directMessage.titleVoice': copy('Denunciar mensagem de voz'),
  'safety.subject.directMessage.privacy': copy(
    'A equipe vê só esta mensagem, não o resto da conversa.',
  ),
  'safety.subject.directMessage.privacyVoice': copy(
    'A equipe ouve só esta mensagem de voz, não o resto da conversa.',
  ),
  'safety.reasons.offensive': copy('Conteúdo ofensivo ou de ódio'),
  'safety.reasons.harassment': copy('Assédio ou bullying'),
  'safety.reasons.spam': copy('Spam ou propaganda'),
  'safety.reasons.sexualViolent': copy('Conteúdo sexual ou violento'),
  'safety.reasons.other': copy('Outro motivo'),
  'safety.sheet.intro': copy(
    'Diga o que há de errado. A equipe de {tenant} vai analisar.',
    'tenant',
  ),
  'safety.sheet.noteLabel': copy('Quer dar mais detalhes? (opcional)'),
  'safety.sheet.noteCounter': copy('{count}/500', 'count'),
  'safety.sheet.submit': copy('Enviar denúncia'),
  'safety.sheet.submitting': copy('Enviando…'),
  'safety.sheet.success': copy('Denúncia enviada. Obrigado por avisar.'),
  'safety.sheet.already': copy('Você já denunciou isto.'),
  'safety.sheet.failure': copy('Não foi possível enviar agora. Nada foi alterado. Tente de novo.'),
  'safety.sheet.gone': copy('Este conteúdo não está mais disponível.'),
  'safety.block.title': copy('Bloquear {nome}?', 'nome'),
  'safety.block.bodySocialOff': copy(BLOCK_SOCIAL_OFF, 'nome'),
  'safety.block.bodySocialOn': copy(BLOCK_SOCIAL_ON, 'nome'),
  'safety.block.confirm': copy('Bloquear'),
  'safety.block.cancel': copy('Cancelar'),
  'safety.block.blocked': copy('{nome} foi bloqueado.', 'nome'),
  'safety.block.unblocked': copy('{nome} foi desbloqueado.', 'nome'),
  'safety.settings.blockedRow': copy('Membros bloqueados'),
  'safety.settings.reportsRow': copy('Denúncias'),
  'safety.blocked.title': copy('Membros bloqueados'),
  'safety.blocked.unblock': copy('Desbloquear'),
  'safety.blocked.unblocking': copy('Desbloqueando…'),
  'safety.blocked.emptyTitle': copy('Você não bloqueou ninguém'),
  'safety.blocked.emptyBody': copy(
    'Quando você bloquear alguém, a pessoa aparece aqui para você desbloquear.',
  ),
  'safety.queue.title': copy('Denúncias'),
  'safety.queue.filter.open': copy('Abertas'),
  'safety.queue.filter.resolved': copy('Resolvidas'),
  'safety.queue.filter.all': copy('Todas'),
  'safety.queue.empty.title': copy('Nenhuma denúncia por aqui'),
  'safety.queue.empty.body': copy(
    'Quando um membro denunciar uma publicação, um comentário, um story, uma comunidade ou uma mensagem, ela aparece aqui.',
  ),
  'safety.queue.resolve': copy('Resolver'),
  'safety.queue.resolveTitle': copy('Resolver denúncia'),
  'safety.queue.viewContent': copy('Ver conteúdo'),
  'safety.queue.meta': copy('Motivo: {motivo} · por {nome} · {data}', 'motivo', 'nome', 'data'),
  'safety.queue.removedMember': copy('Membro removido'),
  'safety.queue.author': copy('Autor: {nome}', 'nome'),
  'safety.queue.state.open': copy('Aberta'),
  'safety.queue.state.dismissed': copy('Ignorada'),
  'safety.queue.state.contentRemoved': copy('Conteúdo removido'),
  'safety.queue.state.communityArchived': copy('Comunidade arquivada'),
  'safety.queue.state.authorBlocked': copy('Autor bloqueado'),
  'safety.queue.body.storyEmpty': copy('Story sem texto.'),
  'safety.queue.body.messageNote': copy('Só esta mensagem é mostrada.'),
  'safety.queue.body.voiceGone': copy('Mensagem de voz apagada'),
  'safety.queue.body.unavailable': copy('Conteúdo não está mais disponível'),
  'safety.queue.removeDialog.title': copy('Remover este conteúdo?'),
  'safety.queue.removeDialog.body': copy(
    'O conteúdo some para todos. A ação fica registrada no histórico de moderação.',
  ),
  'safety.queue.removeDialog.confirm': copy('Remover'),
  'safety.queue.removeDialog.cancel': copy('Cancelar'),
  'safety.queue.toasts.resolved': copy('Denúncia resolvida.'),
  'safety.queue.toasts.alreadyResolved': copy('Esta denúncia já foi resolvida.'),
};

const EXPECTED: Record<string, Copy> = {
  ...CHAT,
  ...SOCIAL,
  ...NOTIFICATIONS,
  ...MODERATION,
  ...SAFETY,
};

/** What each file owns that is NEW in Phase 11: the exact subtrees the key-set test compares. */
const OWNED: Record<string, RegExp> = {
  chat: /^chat\.(navConversations$|navConversationsBadge$|conversations\.|direct\.)/,
  social: /^social\.(profile\.|directory\.messageAria$)/,
  notifications: /^notifications\.kinds\.(socialFollowed|moderationReport)$/,
  moderation: /^moderation\.report\./,
  safety: /^safety\./,
};

describe('11-18 — the Phase 11 catalog: key sets', () => {
  for (const [file, owned] of Object.entries(OWNED)) {
    it(`${file}: the new subtree is EXACTLY the contract (no missing key, no stray one)`, () => {
      const present = Object.keys(all)
        .filter((key) => owned.test(key))
        .sort();
      const expected = Object.keys(EXPECTED)
        .filter((key) => owned.test(key))
        .sort();
      expect(present).toEqual(expected);
    });
  }

  it('safety.json declares the single root key `safety`', () => {
    const roots = Object.keys(messages);
    expect(roots).toContain('safety');
    expect(Object.keys(messages.safety as MessageTree).length).toBeGreaterThan(0);
  });
});

describe('11-18 — every sentence verbatim and every placeholder', () => {
  it.each(Object.entries(EXPECTED))('%s', (key, { text, names }) => {
    expect(all[key]).toBe(text);
    expect(placeholders(text)).toEqual(names);
    expect(placeholders(all[key] as string)).toEqual(names);
  });
});

describe('11-18 — the ICU plurals format for 0, 1, 2 and 100', () => {
  it('the bubble: "# conversa(s) com mensagem nova" (pt-BR reads 0 as singular)', () => {
    expect(t('chat.navConversationsBadge', { count: 0 })).toBe(
      'Conversas, 0 conversa com mensagem nova',
    );
    expect(t('chat.navConversationsBadge', { count: 1 })).toBe(
      'Conversas, 1 conversa com mensagem nova',
    );
    expect(t('chat.navConversationsBadge', { count: 2 })).toBe(
      'Conversas, 2 conversas com mensagem nova',
    );
    expect(t('chat.navConversationsBadge', { count: 100 })).toBe(
      'Conversas, 100 conversas com mensagem nova',
    );
  });

  it('the row name: "# mensagem(ns) nova(s)", the count clause only through this key', () => {
    const name = (count: number) =>
      t('chat.conversations.row.label', { name: 'Ana Lima', count, preview: 'Oi' });
    expect(name(1)).toBe('Ana Lima, 1 mensagem nova. Oi');
    expect(name(2)).toBe('Ana Lima, 2 mensagens novas. Oi');
    expect(name(100)).toBe('Ana Lima, 100 mensagens novas. Oi');
    expect(name(0)).toBe('Ana Lima, 0 mensagem nova. Oi');
  });

  it('the placeholders fill', () => {
    expect(t('chat.conversations.support.name', { tenant: 'Rede Demo' })).toBe('Equipe Rede Demo');
    expect(t('chat.direct.blocker.text', { nome: 'Ana Lima' })).toBe('Você bloqueou Ana Lima');
    expect(t('safety.queue.meta', { motivo: 'Spam', nome: 'Ana', data: '17/11/2026' })).toBe(
      'Motivo: Spam · por Ana · 17/11/2026',
    );
    expect(t('safety.block.bodySocialOn', { nome: 'Ana' })).toContain(
      'Ana não pode mais seguir você nem escrever para você, e vocês dois deixam de se seguir.',
    );
  });
});

/** The strings of Phase 11 by who can read them (UI-D-860). */
const NEW = Object.keys(EXPECTED);
const byPrefix = (...prefixes: string[]) =>
  NEW.filter((key) => prefixes.some((prefix) => key.startsWith(prefix)));

describe('11-18 — the forbidden words of UI-D-860, by audience', () => {
  const FORBIDDEN_EVERYWHERE = [
    ['direta', /\bdireta\b/i],
    ['DM', /\bDM\b/],
    ['privada', /\bprivada\b/i],
    ['inbox', /\binbox\b/i],
  ] as const;

  it.each(FORBIDDEN_EVERYWHERE)('no new string says "%s"', (_word, pattern) => {
    expect(NEW.filter((key) => pattern.test(all[key] as string))).toEqual([]);
  });

  it('the blocked side reads no block word: the list, the empty thread, the composer, the closed strip, the not-found and the menu title', () => {
    // Everything of `conversations.*` and `direct.*` EXCEPT what only the blocker can read (the strip with
    // the way to unblock) and the member-menu row "Bloquear {nome}", which names the ACTION and no fact.
    const blockedSide = byPrefix('chat.conversations.', 'chat.direct.', 'chat.nav').filter(
      (key) => !key.startsWith('chat.direct.blocker.') && key !== 'chat.direct.menu.block',
    );
    expect(blockedSide.length).toBeGreaterThan(10);
    expect(
      blockedSide.filter((key) => /bloque|bloqueou|bloqueio/i.test(all[key] as string)),
    ).toEqual([]);
  });

  it('the one sentence a blocked member reads names no one, no reason and no date', () => {
    const closed = all['chat.direct.closed'] as string;
    expect(closed).toBe('Esta conversa não aceita novas mensagens.');
    expect(placeholders(closed)).toEqual([]);
    expect(closed).not.toMatch(/bloque|motivo|desde|porque|denunci/i);
  });

  it('nothing a reported member can read says "denunciado" or "denunciaram"', () => {
    const memberReadable = NEW.filter((key) => !key.startsWith('safety.queue.'));
    expect(
      memberReadable.filter((key) => /denunciad|denunciaram/i.test(all[key] as string)),
    ).toEqual([]);
    // the administrator's own screens do not need it either
    expect(NEW.filter((key) => /denunciad|denunciaram/i.test(all[key] as string))).toEqual([]);
  });

  it('"moderação" is on no member screen (the administrator\'s dialogs may say it)', () => {
    const memberScreens = NEW.filter(
      (key) =>
        !key.startsWith('safety.queue.') &&
        !key.startsWith('moderation.') &&
        !key.startsWith('safety.settings.reportsRow'),
    );
    expect(memberScreens.filter((key) => /modera/i.test(all[key] as string))).toEqual([]);
  });

  it('"áudio" is never next to "mensagem de voz"', () => {
    const voice = NEW.filter((key) => /mensagem de voz/i.test(all[key] as string));
    expect(voice.length).toBeGreaterThanOrEqual(3);
    expect(voice.filter((key) => /áudio|audio/i.test(all[key] as string))).toEqual([]);
  });

  it('"bloqueou" sits only on the blocker\'s own strings: the strip and the empty list of blocked members', () => {
    const wording = NEW.filter((key) => /bloqueou/.test(all[key] as string));
    expect(wording).toEqual(['chat.direct.blocker.text', 'safety.blocked.emptyTitle']);
  });

  it('no new string carries an em dash or a raw ellipsis of three dots', () => {
    expect(NEW.filter((key) => /—|\.\.\./.test(all[key] as string))).toEqual([]);
  });
});

describe('11-18 — nothing existing was overridden', () => {
  it('the shipped sentences the contract reuses are untouched', () => {
    expect(all['chat.removed.name']).toBe('Membro removido');
    expect(all['chat.mine.previewOwn']).toBe('Você: {text}');
    expect(all['chat.mine.previewTeam']).toBe('Equipe: {text}');
    expect(all['chat.voice.preview']).toBe('Mensagem de voz · {duration}');
    expect(all['chat.voice.deleted']).toBe('Mensagem de voz apagada');
    expect(all['social.errors.follow']).toBe('Não foi possível seguir agora. Tente novamente.');
    expect(all['chat.nav']).toBe('Suporte');
  });
});
