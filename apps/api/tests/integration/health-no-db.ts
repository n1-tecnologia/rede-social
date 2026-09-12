/**
 * Child-process probe used by `health.test.ts`. Booted with a `DATABASE_URL` that points at a closed
 * port so the two credential-independence claims can be proven in a FRESH process:
 *   `tsx health-no-db.ts`          -> `GET /v1/health`        must answer 200 (no DB access at all)
 *   `tsx health-no-db.ts --deep`   -> `GET /v1/health?deep=1`  must answer 500 with `db: false`
 * Run through tsx, never by Vitest (the suite's `include` only picks up `*.test.ts`).
 */
import { app } from '../../src/app';

const deep = process.argv.includes('--deep');
const res = await app.request(deep ? '/v1/health?deep=1' : '/v1/health');
const body = await res.text();
const expected = deep ? 500 : 200;

if (res.status !== expected) {
  process.stderr.write(`expected ${expected}, got ${res.status}: ${body}\n`);
  process.exit(1);
}
// The deep run reports on stderr and exits non-zero so a green exit always means "200 without a DB".
if (deep) {
  process.stderr.write(`${res.status} ${body}\n`);
  process.exit(1);
}
process.stdout.write(body);
