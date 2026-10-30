import { parseAnswer } from '@rede-social/contracts/profile-form';
import { describe, expect, it } from 'vitest';
import { normalizeLink } from './link';
import { question } from './test-fixtures';

/**
 * 12-13 (D-590, UI-D-585; T-12-31) — the link normaliser adds `https://` to a bare address and nothing else.
 * It never turns a refused scheme into an accepted one: the contract's `parseAnswer` is the only judge.
 */

describe('normalizeLink', () => {
  it.each([
    ['exemplo.com.br', 'https://exemplo.com.br'],
    ['www.exemplo.com.br/perfil?x=1', 'https://www.exemplo.com.br/perfil?x=1'],
    ['  exemplo.com.br  ', 'https://exemplo.com.br'],
    ['//exemplo.com.br', 'https://exemplo.com.br'],
    ['localhost:3000/x', 'https://localhost:3000/x'],
    ['exemplo.com:8080', 'https://exemplo.com:8080'],
    ['instagram.com/fulano', 'https://instagram.com/fulano'],
  ])('%s becomes %s', (raw, expected) => {
    expect(normalizeLink(raw)).toBe(expected);
  });

  it('leaves a link that already has http or https exactly as it is', () => {
    expect(normalizeLink('https://exemplo.com.br')).toBe('https://exemplo.com.br');
    expect(normalizeLink('http://exemplo.com.br/a')).toBe('http://exemplo.com.br/a');
    expect(normalizeLink('HTTPS://Exemplo.com')).toBe('HTTPS://Exemplo.com');
  });

  it('leaves every other scheme untouched so the contract refuses it', () => {
    for (const raw of [
      'ftp://exemplo.com',
      'javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'mailto:a@b.com',
      'file:///etc/passwd',
      'vbscript:x',
    ]) {
      expect(normalizeLink(raw)).toBe(raw);
      expect(parseAnswer(question('link'), normalizeLink(raw)).ok).toBe(false);
    }
  });

  it('an empty text stays empty', () => {
    expect(normalizeLink('')).toBe('');
    expect(normalizeLink('   ')).toBe('');
  });

  it('what it returns for a bare address is accepted by the contract', () => {
    const parsed = parseAnswer(question('link'), normalizeLink('exemplo.com.br'));
    expect(parsed.ok).toBe(true);
  });
});
