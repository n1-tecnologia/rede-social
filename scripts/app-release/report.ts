/**
 * The ONE door through which `platform:app-release` speaks (13-29, T-13-50). Every line is
 * `app-release <step> <outcome> [<reason>]` built from closed identifiers only: a step and a reason must match a
 * tight pattern, so free text (and with it any value a store or a credential could put in a message) cannot reach
 * the output. There are no timestamps, so two dry runs print byte-identical logs.
 */

const IDENTIFIER = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;

export type Outcome = 'ok' | 'created' | 'reused' | 'planned' | 'skipped' | 'refused' | 'failed';

/** The closed reasons a release run refuses with. A reason never carries a value. */
export const REFUSAL_REASONS = [
  'tenant_not_found',
  'no_primary_host',
  'no_app_ids',
  'no_brand_colors',
  'no_logo',
  'missing_credentials',
  'missing_checklist',
  'app_record_missing',
  'tool_missing',
  'signing_failed',
  'store_failed',
  'workspace_missing',
  'bad_arguments',
  'artifact_missing',
  // The listing push (13-31): each is raised before any store call.
  'privacy_url_missing',
  'reviewer_missing',
  'contact_missing',
  'tenant_name_empty',
] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

/** A refusal: `message` IS the closed reason, `missing` lists closed item names (never values). */
export class ReleaseRefusal extends Error {
  readonly reason: RefusalReason;
  readonly missing: readonly string[];
  constructor(reason: RefusalReason, missing: readonly string[] = []) {
    super(reason);
    this.name = 'ReleaseRefusal';
    this.reason = reason;
    this.missing = missing;
  }
}

export type Reporter = (step: string, outcome: Outcome, reason?: string) => void;

const stdoutSink = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

/** `sink` defaults to standard output; tests pass their own to read the lines back. */
export function createReporter(sink: (line: string) => void = stdoutSink): Reporter {
  return (step, outcome, reason) => {
    if (!IDENTIFIER.test(step) || (reason !== undefined && !IDENTIFIER.test(reason))) {
      throw new Error('report: step and reason must be closed identifiers');
    }
    sink(`app-release ${step} ${outcome}${reason === undefined ? '' : ` ${reason}`}`);
  };
}

/** Prints one https URL on its own line (the workflow run URL). A URL is not a secret, but it is still validated. */
export function printUrl(url: string, sink: (line: string) => void = stdoutSink): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
    throw new Error('printUrl: https URL without credentials only');
  }
  sink(`app-release run-url ${parsed.origin}${parsed.pathname}`);
}
