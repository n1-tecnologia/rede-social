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
