import { randomInt } from 'node:crypto';
import { EVENT_CHECKIN_CODE_ALPHABET, EVENT_CHECKIN_CODE_LENGTH } from '../contracts/index';

/**
 * The venue code (D-208, D-217, T-06-07).
 *
 * Drawn with `crypto.randomInt`, a CSPRNG, one symbol at a time from the 31-symbol unambiguous
 * alphabet: 31^4 = 923,521 codes. A non-cryptographic source would make the next code predictable
 * from the previous ones, and the code is the only thing that makes "Presente" mean "was there".
 * Bounding wrong guesses is 06-05's job; the database pins the shape (`event_secrets_code_chk`).
 */
export function generateCheckinCode(): string {
  let code = '';
  for (let i = 0; i < EVENT_CHECKIN_CODE_LENGTH; i += 1) {
    code += EVENT_CHECKIN_CODE_ALPHABET[randomInt(EVENT_CHECKIN_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * What a member typed, in the stored shape: uppercased, with whitespace and hyphens removed, so
 * `' k7-qm '` compares equal to `'K7QM'`. It never maps look-alikes (an `O` stays an `O` and is
 * simply wrong), because the alphabet already excludes them.
 */
export function normalizeCheckinCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]+/g, '');
}
