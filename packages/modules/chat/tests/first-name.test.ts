import { describe, expect, it } from 'vitest';
import { firstNameOf } from '../server/first-name';

/** D-222: a member learns the agent's first name and nothing else. */
describe('firstNameOf', () => {
  it('answers the first whitespace-separated token', () => {
    expect(firstNameOf('Carla Rocha')).toBe('Carla');
    expect(firstNameOf('Ana Carolina Albuquerque de Vasconcellos')).toBe('Ana');
    expect(firstNameOf('  Íris   Muñoz ')).toBe('Íris');
    expect(firstNameOf('Bruno\tLima')).toBe('Bruno');
    expect(firstNameOf('Sofia\nD’Ávila')).toBe('Sofia');
  });

  // The same golden pairs as apps/web/lib/chat-view.test.ts (the web twin cannot import this file).
  it('splits on a no-break space and trims an ideographic space', () => {
    expect(firstNameOf('Zoë\u00A0Lima')).toBe('Zoë');
    expect(firstNameOf('\u3000Yuki Tanaka')).toBe('Yuki');
  });

  it('keeps a single-token name whole', () => {
    expect(firstNameOf('Carla')).toBe('Carla');
    expect(firstNameOf("D'Ávila")).toBe("D'Ávila");
  });

  it("gives '' for a missing, empty or whitespace-only name", () => {
    expect(firstNameOf(null)).toBe('');
    expect(firstNameOf(undefined)).toBe('');
    expect(firstNameOf('')).toBe('');
    expect(firstNameOf('   \n ')).toBe('');
  });
});
