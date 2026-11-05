/**
 * GitHub Actions masking (13-29, T-13-50, D-605). `::add-mask::<value>` makes the runner replace the value with
 * `***` in every later log line of the job. It must be emitted BEFORE the value is written anywhere, and a
 * multi-line value (a PEM key) needs more than one line of it:
 *  - the runner matches line by line when a log splits the value, so every line is masked on its own;
 *  - the whole value is masked too, with `%`, CR and LF escaped as the workflow-command syntax requires, so one
 *    command never carries a raw line break.
 * The PEM armour lines (`-----BEGIN ...-----`) are not secret and are skipped, so the common sentence is not
 * redacted from every later log.
 */

/** A value shorter than this would redact ordinary words; every real secret here is longer. */
const MIN_LENGTH = 4;

const escapeData = (value: string): string =>
  value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

const isArmour = (line: string): boolean => line.startsWith('-----');

/** Emits one mask line per distinct value and per distinct line of a multi-line value. Returns how many. */
export function maskValues(values: Iterable<string>, write: (line: string) => void): number {
  const seen = new Set<string>();
  const emit = (value: string): void => {
    if (value.length < MIN_LENGTH || seen.has(value)) return;
    seen.add(value);
    write(`::add-mask::${escapeData(value)}`);
  };
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const lines = value
      .split(/\r\n|\r|\n/)
      .map((line) => line.trim())
      .filter((line) => !isArmour(line));
    for (const line of lines) emit(line);
    if (value.trim() !== lines[0] || lines.length > 1) emit(value.trim());
  }
  return seen.size;
}

/** The base64 body of a PEM, armour and line breaks removed (what a log would show if the key were joined). */
const pemBodyOf = (text: string): string | null => {
  if (!text.includes('-----BEGIN')) return null;
  const body = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !isArmour(line))
    .join('');
  return body === '' ? null : body;
};

/**
 * Every string a credential could leak: the whole sealed text, every string inside it when it is JSON (key ids,
 * issuer ids, passwords, base64 keystores, PEM keys), and the joined body of every PEM.
 */
export function secretValuesOf(plain: string): string[] {
  const out = new Set<string>();
  const add = (value: string): void => {
    if (value.length >= MIN_LENGTH) out.add(value);
  };
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      add(value);
      const body = pemBodyOf(value);
      if (body) add(body);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (typeof value === 'object' && value !== null) {
      for (const item of Object.values(value)) walk(item);
    }
  };
  add(plain.trim());
  try {
    walk(JSON.parse(plain));
  } catch {
    walk(plain);
  }
  return [...out];
}
