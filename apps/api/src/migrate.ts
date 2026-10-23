import { parseArgs } from 'node:util';
import { migrateAll } from '@rede-social/core/server/projects/migrate';

/**
 * `ROLE=migrate` (09.2-15, D-544): the fan-out as a process role of the API image, run by the deploy as a Cloud
 * Run Job (plan 16) and locally by `pnpm db:migrate-all`. It binds no listener and returns an exit code; the
 * caller (`main.ts`, `scripts/migrate-all.ts`) exits with it.
 *
 *   --dry-run          list the pending versions per project and write nothing
 *   --tenant <slug>    the tenant's project only (exact slug)
 *   --project <ref>    one project only (exact ref)
 *   --concurrency <n>  projects migrated at once (default 4)
 *   --strict           exit 1 when any tenant project failed (off: a tenant failure is a warning)
 *   --central-only     apply the central set and stop
 *
 * Exit 0 ok, 1 the central set failed (nothing else attempted) or `--strict` saw a failure, 2 a usage error.
 * Every line printed is one JSON object with ASCII keys; none carries a connection string or SQL text.
 */
export async function runMigrateAll(argv: string[]): Promise<number> {
  let values: {
    'dry-run'?: boolean;
    tenant?: string;
    project?: string;
    concurrency?: string;
    strict?: boolean;
    'central-only'?: boolean;
  };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        'dry-run': { type: 'boolean', default: false },
        tenant: { type: 'string' },
        project: { type: 'string' },
        concurrency: { type: 'string' },
        strict: { type: 'boolean', default: false },
        'central-only': { type: 'boolean', default: false },
      },
      strict: true,
    }));
  } catch {
    console.error(
      'usage: migrate [--dry-run] [--tenant <slug>] [--project <ref>] [--concurrency <n>] [--strict] [--central-only]',
    );
    return 2;
  }

  const concurrency = values.concurrency === undefined ? undefined : Number(values.concurrency);
  const result = await migrateAll({
    dryRun: values['dry-run'] === true,
    strict: values.strict === true,
    centralOnly: values['central-only'] === true,
    ...(values.tenant !== undefined ? { tenantSlug: values.tenant } : {}),
    ...(values.project !== undefined ? { projectRef: values.project } : {}),
    ...(concurrency !== undefined ? { concurrency } : {}),
  });

  for (const line of result.lines) {
    // A usage message goes to stderr; the data lines go to stdout (the Job's log).
    if (line.kind === 'usage') console.error(JSON.stringify(line));
    else console.log(JSON.stringify(line));
  }
  return result.exitCode;
}
