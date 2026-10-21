import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMessages, type MessageTree } from './messages';

/**
 * 09.1-16 (UI-D-531) — the words this plan adds to the Membros screen and to the platform Módulos row,
 * pinned against the REAL merged catalog. A copy edit must not move them silently: the strings are the
 * approved Copywriting Contract rows "Membros" and "Platform row". Kept in its own file so this plan
 * and the Pagamentos plans never edit one test file together.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR')) as MessageTree;

function at(path: string): unknown {
  let node: unknown = messages;
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as MessageTree)[part];
  }
  return node;
}

describe('09.1-16 — Membros (UI-D-523, UI-D-531)', () => {
  const ROWS: [string, string][] = [
    ['admin.members.filters.subscriptionPending', 'Assinatura pendente'],
    ['admin.members.pills.subscriptionPending', 'Assinatura pendente'],
    ['admin.members.subscriptionPendingEmpty.title', 'Nenhuma assinatura pendente'],
    [
      'admin.members.subscriptionPendingEmpty.body',
      'Quem estiver com a assinatura atrasada ou cancelada aparece aqui. O acesso volta sozinho quando o pagamento é confirmado.',
    ],
    [
      'admin.members.subscriptionPendingNote',
      'Assinatura pendente. O acesso volta sozinho quando o pagamento for confirmado.',
    ],
  ];

  it.each(ROWS)('%s reads exactly as the Copywriting Contract', (path, text) => {
    expect(at(path)).toBe(text);
  });

  it('keeps the four shipped filters and the three shipped pills unchanged', () => {
    expect(at('admin.members.filters.all')).toBe('Todos');
    expect(at('admin.members.filters.active')).toBe('Ativos');
    expect(at('admin.members.filters.blocked')).toBe('Bloqueados');
    expect(at('admin.members.filters.invited')).toBe('Convidados');
    expect(at('admin.members.pills.blocked')).toBe('Bloqueado');
    expect(at('admin.members.pills.invited')).toBe('Convite pendente');
    expect(at('admin.members.pills.emailUnconfirmed')).toBe('E-mail não confirmado');
  });
});
