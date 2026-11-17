import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages, type MessageTree } from './messages';

/**
 * Phase 12.4-11 (UI-D-816, UI-D-834, CASE-27, D-800) — the `chat` copy of the support case. This file pins
 * what a copy edit must not break: the exact key set of the case copy (the UI-SPEC Copywriting Contract
 * plus `history.actorGone` and `inbox.filter.rosterError`), every sentence verbatim (the pt-BR strings
 * ARE the contract), every placeholder, and the forbidden-word scan of CASE-27.
 *
 * Real merged catalog, real next-intl formatter. Everything here is pure and read-only (no write, no
 * temp file, no network), so two parallel runs, or one beside `scripts/check-ui-literals.sh`, cannot
 * change each other's result (EP-095).
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
const chat = messages.chat as MessageTree;

/** Every leaf of a namespace as `dotted.path -> string`. */
function leaves(tree: MessageTree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, leaves(value, path));
  }
  return out;
}

const all = leaves(chat);

/** The names a message interpolates: `{name}` and `{name, plural, …}`, not the text inside a form. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)(?:,|\})/g)].map((match) => match[1] as string).sort();
}

const translate = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'chat' as never,
}) as unknown as (key: string, values?: Record<string, unknown>) => string;

/**
 * The case copy, key by key: the sentence and the placeholders it interpolates. The first block is the
 * UI-SPEC table; the last two keys are the plan's own additions (A-12.4-ACTOR-GONE).
 */
const CASE_COPY: Record<string, { text: string; names: string[] }> = {
  'state.open': { text: 'Aberto', names: [] },
  'state.inProgress': { text: 'Em atendimento', names: [] },
  'state.resolved': { text: 'Resolvido', names: [] },
  'state.closed': { text: 'Fechado', names: [] },
  'category.checkIn': { text: 'Check-in', names: [] },
  'category.events': { text: 'Eventos', names: [] },
  'category.payment': { text: 'Pagamento', names: [] },
  'category.account': { text: 'Conta', names: [] },
  'category.other': { text: 'Outro', names: [] },
  'priority.low': { text: 'Baixa', names: [] },
  'priority.normal': { text: 'Normal', names: [] },
  'priority.high': { text: 'Alta', names: [] },
  'case.title': { text: 'Chamado #{number}', names: ['number'] },
  'case.mine': { text: 'Meus chamados', names: [] },
  'case.srName': { text: 'Chamado #{number}, {state}', names: ['number', 'state'] },
  'case.opened.title': { text: 'Chamado #{number} aberto.', names: ['number'] },
  'case.opened.body': {
    text: 'A equipe responde por aqui. Avisamos quando houver resposta.',
    names: [],
  },
  'case.resolvedNotice': {
    text: 'Este chamado foi marcado como resolvido. Se ainda precisar de ajuda, responda aqui e ele volta a ser atendido.',
    names: [],
  },
  'case.reopenedToast': { text: 'Chamado #{number} reaberto.', names: ['number'] },
  'case.closedNotice': {
    text: 'Este chamado foi fechado. Para falar com a equipe de novo, abra um novo chamado.',
    names: [],
  },
  'case.newCase': { text: 'Novo chamado', names: [] },
  'open.category': { text: 'Sobre o que é?', names: [] },
  'open.subject.label': { text: 'Assunto (opcional)', names: [] },
  'open.subject.placeholder': { text: 'Resuma em uma frase', names: [] },
  'composer.placeholderNew': { text: 'Conte o que você precisa', names: [] },
  'composer.sendNew': { text: 'Abrir chamado', names: [] },
  'member.empty.body': {
    text: 'Escolha o assunto, conte o que você precisa e avisamos quando a equipe responder.',
    names: [],
  },
  'mine.title': { text: 'Meus chamados', names: [] },
  'mine.current': { text: 'Chamado atual', names: [] },
  'mine.previous': { text: 'Anteriores', names: [] },
  'mine.previewOwn': { text: 'Você: {text}', names: ['text'] },
  'mine.previewTeam': { text: 'Equipe: {text}', names: ['text'] },
  'mine.empty.title': { text: 'Você ainda não abriu nenhum chamado', names: [] },
  'mine.empty.body': {
    text: 'Quando você falar com a equipe, o chamado aparece aqui.',
    names: [],
  },
  'mine.empty.cta': { text: 'Falar com a equipe', names: [] },
  'mine.errors.load.title': { text: 'Não foi possível carregar seus chamados.', names: [] },
  'mine.errors.load.body': { text: 'Verifique sua conexão e tente de novo.', names: [] },
  'mine.errors.more': { text: 'Não foi possível carregar mais chamados.', names: [] },
  'inbox.tab.open': { text: 'Em aberto', names: [] },
  'inbox.tab.resolved': { text: 'Resolvidos', names: [] },
  'inbox.tab.closed': { text: 'Fechados', names: [] },
  'inbox.tab.label': { text: 'Chamados por estado', names: [] },
  'inbox.filter.owner': { text: 'Responsável', names: [] },
  'inbox.filter.ownerValue': { text: 'Responsável: {value}', names: ['value'] },
  'inbox.filter.priority': { text: 'Prioridade', names: [] },
  'inbox.filter.priorityValue': { text: 'Prioridade: {value}', names: ['value'] },
  'inbox.filter.awaiting': { text: 'Aguardando resposta', names: [] },
  'inbox.filter.clear': { text: 'Limpar filtros', names: [] },
  'inbox.filter.ownerAll': { text: 'Todos', names: [] },
  'inbox.filter.ownerMe': { text: 'Eu', names: [] },
  'inbox.filter.ownerNone': { text: 'Sem responsável', names: [] },
  'inbox.filter.priorityAll': { text: 'Todas', names: [] },
  'inbox.filter.rosterError': { text: 'Não foi possível carregar a equipe.', names: [] },
  'inbox.meta.owned': { text: '{category} · Com {name}', names: ['category', 'name'] },
  'inbox.meta.unowned': { text: '{category} · Sem responsável', names: ['category'] },
  'inbox.meta.mine': { text: '{category} · Com você', names: ['category'] },
  'inbox.rowSubject': { text: '#{number} · {subject}', names: ['number', 'subject'] },
  'inbox.empty.open.title': { text: 'Nenhum chamado em aberto', names: [] },
  'inbox.empty.open.body': {
    text: 'Quando um membro pedir ajuda, o chamado aparece aqui.',
    names: [],
  },
  'inbox.empty.awaiting.title': { text: 'Ninguém aguardando resposta', names: [] },
  'inbox.empty.awaiting.body': {
    text: 'Todos os chamados em aberto já foram respondidos.',
    names: [],
  },
  'inbox.empty.resolved.title': { text: 'Nenhum chamado resolvido', names: [] },
  'inbox.empty.resolved.body': {
    text: 'Os chamados marcados como resolvidos aparecem aqui até serem fechados.',
    names: [],
  },
  'inbox.empty.closed.title': { text: 'Nenhum chamado fechado', names: [] },
  'inbox.empty.closed.body': { text: 'Os chamados fechados ficam guardados aqui.', names: [] },
  'inbox.empty.filtered.title': { text: 'Nenhum chamado com esses filtros', names: [] },
  'inbox.empty.filtered.body': {
    text: 'Tente outro responsável ou outra prioridade.',
    names: [],
  },
  'inbox.idle.title': { text: 'Escolha um chamado', names: [] },
  'inbox.idle.body': {
    text: 'Qualquer pessoa da equipe pode responder. Quando alguém abre o chamado, ele deixa de aparecer como aguardando para toda a equipe.',
    names: [],
  },
  'inbox.errors.loadMore': { text: 'Não foi possível carregar mais chamados.', names: [] },
  'staffCase.detailsLabel': { text: 'Ver detalhes do chamado #{number}', names: ['number'] },
  'staffCase.meta.owned': {
    text: '{category} · {priority} · Com {name}',
    names: ['category', 'name', 'priority'],
  },
  'staffCase.meta.unowned': {
    text: '{category} · {priority} · Sem responsável',
    names: ['category', 'priority'],
  },
  'staffCase.meta.mine': {
    text: '{category} · {priority} · Com você',
    names: ['category', 'priority'],
  },
  'staffCase.takeOnReply': { text: 'Ao responder, você assume este chamado.', names: [] },
  'staffCase.closedNotice': {
    text: 'Este chamado está fechado. A conversa fica disponível só para leitura.',
    names: [],
  },
  'action.more': { text: 'Mais ações', names: [] },
  'action.take': { text: 'Assumir', names: [] },
  'action.assign': { text: 'Atribuir a…', names: [] },
  'action.resolve': { text: 'Resolver', names: [] },
  'action.reopen': { text: 'Reabrir', names: [] },
  'action.close': { text: 'Fechar', names: [] },
  'action.edit': { text: 'Editar categoria, assunto e prioridade', names: [] },
  'action.details': { text: 'Ver detalhes e histórico', names: [] },
  'dialog.cancel': { text: 'Cancelar', names: [] },
  'dialog.resolve.title': {
    text: 'Marcar o chamado #{number} como resolvido?',
    names: ['number'],
  },
  'dialog.resolve.body': {
    text: 'O membro recebe um aviso. Se ele responder, o chamado volta a ficar aberto.',
    names: [],
  },
  'dialog.resolve.confirm': { text: 'Sim, resolver', names: [] },
  'dialog.close.title': { text: 'Fechar o chamado #{number}?', names: ['number'] },
  'dialog.close.body': {
    text: 'A conversa fica só para leitura e ninguém poderá reabri-la. Se o membro escrever de novo, abre um novo chamado.',
    names: [],
  },
  'dialog.close.confirm': { text: 'Sim, fechar', names: [] },
  'dialog.reopen.title': { text: 'Reabrir o chamado #{number}?', names: ['number'] },
  'dialog.reopen.body': {
    text: 'Ele volta para Em aberto, sem responsável. O membro não é avisado.',
    names: [],
  },
  'dialog.reopen.confirm': { text: 'Sim, reabrir', names: [] },
  'dialog.take.title': { text: 'Assumir o chamado #{number}?', names: ['number'] },
  'dialog.take.body': {
    text: 'Hoje ele está com {name}. Ele deixa de ser responsável.',
    names: ['name'],
  },
  'dialog.take.confirm': { text: 'Sim, assumir', names: [] },
  'sheet.assign.title': { text: 'Atribuir chamado #{number}', names: ['number'] },
  'sheet.assign.current': { text: 'responsável hoje', names: [] },
  'sheet.assign.hint': { text: 'A pessoa escolhida recebe um aviso.', names: [] },
  'sheet.assign.confirm': { text: 'Atribuir', names: [] },
  'sheet.edit.title': { text: 'Editar chamado #{number}', names: ['number'] },
  'sheet.edit.category': { text: 'Categoria', names: [] },
  'sheet.edit.subject': { text: 'Assunto', names: [] },
  'sheet.edit.subjectHelp': {
    text: 'Em branco, usamos o começo da primeira mensagem.',
    names: [],
  },
  'sheet.edit.priority': { text: 'Prioridade', names: [] },
  'sheet.edit.confirm': { text: 'Salvar alterações', names: [] },
  'toast.taken': { text: 'Chamado #{number} assumido.', names: ['number'] },
  'toast.resolved': { text: 'Chamado #{number} resolvido.', names: ['number'] },
  'toast.closed': { text: 'Chamado #{number} fechado.', names: ['number'] },
  'toast.reopened': { text: 'Chamado #{number} reaberto.', names: ['number'] },
  'toast.assigned': { text: 'Chamado #{number} atribuído a {name}.', names: ['name', 'number'] },
  'toast.saved': { text: 'Alterações salvas.', names: [] },
  'toast.stale': {
    text: 'Este chamado mudou enquanto você olhava. A tela foi atualizada.',
    names: [],
  },
  'toast.failed': { text: 'Não foi possível concluir. Tente de novo.', names: [] },
  'details.title': { text: 'Chamado #{number}', names: ['number'] },
  'details.data': { text: 'Dados', names: [] },
  'details.state': { text: 'Estado', names: [] },
  'details.category': { text: 'Categoria', names: [] },
  'details.priority': { text: 'Prioridade', names: [] },
  'details.owner': { text: 'Responsável', names: [] },
  'details.noOwner': { text: 'Sem responsável', names: [] },
  'details.openedAt': { text: 'Aberto em', names: [] },
  'details.earlier': { text: 'Chamados anteriores deste membro', names: [] },
  'details.earlierMore': { text: 'Mostrando os 5 mais recentes.', names: [] },
  'history.title': { text: 'Histórico', names: [] },
  'history.opened': { text: '{member} abriu o chamado.', names: ['member'] },
  'history.taken': { text: '{actor} assumiu o chamado.', names: ['actor'] },
  'history.assigned': {
    text: '{actor} atribuiu o chamado a {target}.',
    names: ['actor', 'target'],
  },
  'history.resolved': { text: '{actor} marcou como resolvido.', names: ['actor'] },
  'history.closed': { text: '{actor} fechou o chamado.', names: ['actor'] },
  'history.autoClosed': {
    text: 'O chamado foi fechado automaticamente após 7 dias resolvido.',
    names: [],
  },
  'history.reopened': { text: '{actor} reabriu o chamado.', names: ['actor'] },
  'history.reopenedByMember': {
    text: '{member} respondeu e o chamado foi reaberto.',
    names: ['member'],
  },
  'history.category': {
    text: '{actor} mudou a categoria de {from} para {to}.',
    names: ['actor', 'from', 'to'],
  },
  'history.priority': {
    text: '{actor} mudou a prioridade de {from} para {to}.',
    names: ['actor', 'from', 'to'],
  },
  'history.subject': { text: '{actor} mudou o assunto.', names: ['actor'] },
  'history.errors.load': { text: 'Não foi possível carregar o histórico.', names: [] },
  // A-12.4-ACTOR-GONE: the plan's own addition, flagged for the ledger.
  'history.actorGone': { text: 'Alguém da equipe', names: [] },
  'live.resolved': { text: 'Seu chamado #{number} foi resolvido.', names: ['number'] },
  'live.closed': { text: 'Seu chamado #{number} foi fechado.', names: ['number'] },
  'live.reopened': { text: 'Seu chamado #{number} foi reaberto.', names: ['number'] },
  'live.takenBy': { text: 'Chamado #{number} assumido por {name}.', names: ['name', 'number'] },
  'live.resolvedBy': {
    text: 'Chamado #{number} resolvido por {name}.',
    names: ['name', 'number'],
  },
  'live.closedBy': { text: 'Chamado #{number} fechado por {name}.', names: ['name', 'number'] },
  'notFound.title': { text: 'Chamado não encontrado', names: [] },
  'notFound.body': { text: 'Ele não existe ou não é de {tenant}.', names: ['tenant'] },
  'notFound.cta': { text: 'Ver chamados', names: [] },
};

/** The shipped keys the case copy leaves exactly as they were (every other key of the catalog is in CASE_COPY). */
const SHIPPED_UNCHANGED = [
  'nav',
  'navBadge.member',
  'navBadge.staff',
  'member.title',
  'member.back',
  'member.empty.title',
  'thread.label',
  'thread.older',
  'thread.newMessages',
  'thread.retry',
  'thread.errors.load.title',
  'thread.errors.load.body',
  'thread.errors.older',
  'sender.staffSr',
  'sender.you',
  'day.today',
  'day.yesterday',
  'composer.label',
  'composer.placeholder',
  'composer.send',
  'composer.sending',
  'composer.counter',
  'composer.errors.failed',
  'inbox.title',
  'inbox.back',
  'inbox.teamPreview',
  'inbox.awaitingSr',
  'blocked.pill',
  'blocked.notice',
  'removed.name',
  'removed.notice',
  'staff.back',
  'staff.profile',
];

/** The keys the copy table REPLACES (the flat pair became five per-tab pairs). */
const REMOVED_FLAT = ['inbox.empty.title', 'inbox.empty.body'];

// --- the CASE-27 scan (EP-091, EP-093, EP-094, EP-095) --------------------------------------------

/** Words that appear nowhere in the case copy (CASE-27, UI-D-816). */
const FORBIDDEN_EVERYWHERE = ['ticket', 'protocolo', 'sla', 'atendente'];

/** `prioridade` is a staff word: no member-surface key may carry it. */
const MEMBER_SURFACE_PREFIXES = ['case.', 'open.', 'mine.', 'live.', 'notFound.', 'member.'];

/** NFC, format characters (soft hyphen, zero-width space and joiners, word joiner, BOM) stripped, lower-cased. */
function normalise(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\p{Cf}/gu, '')
    .toLowerCase();
}

/** The whole words of a value, after `normalise`. A longer word that merely shares letters is a different word. */
function wordsOf(value: string): string[] {
  return normalise(value).match(/[\p{L}\p{M}\p{N}_]+/gu) ?? [];
}

interface Violation {
  key: string;
  word: string;
}

/** Whole-word, case-insensitive hits over `values`, sorted by key then word so the report is stable. */
function scanForbidden(values: Record<string, string>): Violation[] {
  const hits: Violation[] = [];
  for (const key of Object.keys(values)) {
    const words = new Set(wordsOf(values[key] as string));
    const banned = [...FORBIDDEN_EVERYWHERE];
    if (MEMBER_SURFACE_PREFIXES.some((prefix) => key.startsWith(prefix))) banned.push('prioridade');
    for (const word of banned) if (words.has(word)) hits.push({ key, word });
  }
  return hits.sort((a, b) => a.key.localeCompare(b.key) || a.word.localeCompare(b.word));
}

/** True for an empty value, a whitespace-only one and one that is only placeholders (EP-092). */
function isBlank(value: string): boolean {
  const visible = value
    .replace(/\{\w+\}/g, '')
    .replace(/\{\w+\s*,\s*(?:plural|select|selectordinal)\s*,/g, '')
    .replace(/(?:zero|one|two|few|many|other|=\d+)\s*\{/g, '')
    .replace(/[{}#\s]/g, '');
  return visible === '';
}

describe('12.4-11 — the case copy is exactly the UI-SPEC table (UI-D-834)', () => {
  it('1. the new key set is the table plus history.actorGone and inbox.filter.rosterError, no extra and none missing (EP-092)', () => {
    const present = Object.keys(all).sort();
    const expected = [...SHIPPED_UNCHANGED, ...Object.keys(CASE_COPY)].sort();
    expect(present).toEqual(expected);
    // The flat shipped pair is replaced by the per-tab pairs.
    for (const key of REMOVED_FLAT) expect(all).not.toHaveProperty([key]);
    expect(Object.keys(CASE_COPY)).toContain('history.actorGone');
    expect(Object.keys(CASE_COPY)).toContain('inbox.filter.rosterError');
  });

  it('2. every sentence is the UI-SPEC string, verbatim', () => {
    for (const [key, { text }] of Object.entries(CASE_COPY))
      expect([key, all[key]]).toEqual([key, text]);
  });

  it('3. every value is non-empty and is not a bare placeholder (EP-092)', () => {
    const blank = Object.entries(all)
      .filter(([, value]) => isBlank(value))
      .map(([key]) => key)
      .sort();
    expect(blank).toEqual([]);
  });

  it('4. every placeholder of every sentence is the UI-SPEC one', () => {
    for (const [key, { names }] of Object.entries(CASE_COPY))
      expect([key, placeholders(all[key] as string)]).toEqual([key, names]);
  });

  it('5. the state, category, priority, action and history groups are all there by prefix', () => {
    const count = (prefix: string) =>
      Object.keys(all).filter((key) => key.startsWith(prefix)).length;
    expect(count('state.')).toBe(4);
    expect(count('category.')).toBe(5);
    expect(count('priority.')).toBe(3);
    expect(count('action.')).toBe(8);
    expect(count('history.')).toBe(14);
    expect(count('toast.')).toBe(8);
    expect(count('live.')).toBe(6);
    expect(count('dialog.')).toBe(13);
    expect(count('inbox.empty.')).toBe(10);
  });

  it('6. the placeholders FORMAT, with the case number a plain integer', () => {
    expect(translate('case.title', { number: '1204' })).toBe('Chamado #1204');
    expect(translate('case.srName', { number: '42', state: 'Resolvido' })).toBe(
      'Chamado #42, Resolvido',
    );
    expect(translate('inbox.meta.owned', { category: 'Pagamento', name: 'Carla' })).toBe(
      'Pagamento · Com Carla',
    );
    expect(translate('toast.assigned', { number: '42', name: 'Carla' })).toBe(
      'Chamado #42 atribuído a Carla.',
    );
    expect(translate('history.category', { actor: 'Carla', from: 'Conta', to: 'Pagamento' })).toBe(
      'Carla mudou a categoria de Conta para Pagamento.',
    );
    expect(translate('notFound.body', { tenant: 'Rede Demo' })).toBe(
      'Ele não existe ou não é de Rede Demo.',
    );
    expect(translate('mine.previewTeam', { text: 'Já resolvemos' })).toBe('Equipe: Já resolvemos');
    // The shipped plural still formats beside the new copy.
    expect(translate('thread.newMessages', { count: 3 })).toBe('3 novas mensagens');
  });
});

describe('12.4-11 — CASE-27: the forbidden words over the parsed catalog values', () => {
  it('1. ticket, protocolo, SLA and atendente appear nowhere, and prioridade in no member-surface key', () => {
    expect(scanForbidden(all)).toEqual([]);
  });

  it('2. the member-surface groups hold no staff word, and the staff groups may say prioridade', () => {
    const member = Object.keys(all).filter((key) =>
      MEMBER_SURFACE_PREFIXES.some((prefix) => key.startsWith(prefix)),
    );
    expect(member.length).toBeGreaterThan(20);
    for (const key of member) expect(wordsOf(all[key] as string)).not.toContain('prioridade');
    // The scan is not vacuous: the staff words really do exist outside the member groups.
    expect(wordsOf(all['inbox.filter.priority'] as string)).toContain('prioridade');
  });

  it('3. EP-091: a longer word that shares letters is not a hit, and the word itself is', () => {
    expect(scanForbidden({ 'a.b': 'Em atendimento' })).toEqual([]);
    expect(scanForbidden({ 'a.b': 'Fale com o atendente' })).toEqual([
      { key: 'a.b', word: 'atendente' },
    ]);
    expect(scanForbidden({ 'a.b': 'O Ticket chegou' })).toEqual([{ key: 'a.b', word: 'ticket' }]);
    expect(scanForbidden({ 'a.b': 'sla' })).toEqual([{ key: 'a.b', word: 'sla' }]);
    // `sla` inside another word, or beside a hyphen of another word, is not the word.
    expect(scanForbidden({ 'a.b': 'slate classe islã' })).toEqual([]);
    expect(scanForbidden({ 'a.b': 'protocolos' })).toEqual([]);
    expect(scanForbidden({ 'case.x': 'Prioridade alta' })).toEqual([
      { key: 'case.x', word: 'prioridade' },
    ]);
    expect(scanForbidden({ 'details.x': 'Prioridade alta' })).toEqual([]);
  });

  it('4. EP-093: a soft hyphen, a zero-width space and a decomposed spelling are still caught', () => {
    expect(scanForbidden({ 'a.b': 'ate­ndente' })).toEqual([{ key: 'a.b', word: 'atendente' }]);
    expect(scanForbidden({ 'a.b': 'tick​et' })).toEqual([{ key: 'a.b', word: 'ticket' }]);
    expect(scanForbidden({ 'a.b': 'PRO⁠TOCOLO' })).toEqual([{ key: 'a.b', word: 'protocolo' }]);
    expect(scanForbidden({ 'a.b': 'S﻿LA' })).toEqual([{ key: 'a.b', word: 'sla' }]);
    // Decomposed Unicode normalises to the same string as the composed one before matching.
    expect(normalise('Prioridade é')).toBe(normalise('Prioridade é'));
    expect(wordsOf('Pré-pago')).toEqual(wordsOf('Pré-pago'));
  });

  it('5. EP-094: the report and the checked keys are sorted, so two runs print the same thing', () => {
    const dirty = { 'z.k': 'ticket', 'a.k': 'atendente e sla', 'm.k': 'protocolo' };
    const first = scanForbidden(dirty);
    const second = scanForbidden({ ...dirty });
    expect(first).toEqual(second);
    expect(first.map((hit) => `${hit.key}:${hit.word}`)).toEqual([
      'a.k:atendente',
      'a.k:sla',
      'm.k:protocolo',
      'z.k:ticket',
    ]);
    const keys = Object.keys(all).sort();
    expect(keys).toEqual([...keys].sort());
  });

  it('6. EP-092: an empty value, a whitespace-only one and a bare placeholder are all violations', () => {
    expect(isBlank('')).toBe(true);
    expect(isBlank('   \n\t')).toBe(true);
    expect(isBlank('{number}')).toBe(true);
    expect(isBlank('{count, plural, one {#} other {#}}')).toBe(true);
    expect(isBlank('{a}{b}')).toBe(true);
    expect(isBlank('Chamado #{number}')).toBe(false);
    expect(isBlank('Aberto')).toBe(false);
  });

  it('7. EP-095: the scan is pure and read-only, so a second run over the same values gives the same answer', () => {
    const before = JSON.stringify(all);
    const a = scanForbidden(all);
    const b = scanForbidden(all);
    expect(a).toEqual(b);
    expect(JSON.stringify(all)).toBe(before);
  });
});
