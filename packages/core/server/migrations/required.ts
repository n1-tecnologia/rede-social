/**
 * The tenant schema this image requires (09.2-08, D-545, DBT-25): how many tenant migrations the image
 * ships and the newest one's 14-digit version. A project whose applied schema is BELOW it is held out
 * (`updating`) until the fan-out catches it up; one AHEAD of it (a rolled-back image) is never held out.
 *
 * Plan 15 loads the image manifest and replaces the body of `getRequiredTenantSchema`; until then it
 * answers `null` and the gate is off, so no environment changes behaviour ahead of the fan-out.
 */
export type RequiredTenantSchema = { count: number; head: string };
export type AppliedTenantSchema = { count: number | null; head: string | null };

let override: RequiredTenantSchema | null | undefined;

export function getRequiredTenantSchema(): RequiredTenantSchema | null {
  if (override !== undefined) return override;
  return null;
}

/** Test seam: pin (or clear with `undefined`) the required schema. Refuses to run outside `NODE_ENV=test`. */
export function setRequiredTenantSchemaForTests(
  value: RequiredTenantSchema | null | undefined,
): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('setRequiredTenantSchemaForTests is a test seam');
  }
  override = value;
}

/**
 * `behind` means the applied count OR the applied head is strictly below the required one (14-digit
 * heads compare as strings, which orders them the same as numbers at equal length). Equal or ahead is not
 * behind. Unknown is not behind either: a null `required` (gate off) or a missing/partial `applied`
 * (never probed) holds nothing out.
 */
export function isBehind(
  applied: AppliedTenantSchema | null | undefined,
  required: RequiredTenantSchema | null | undefined,
): boolean {
  if (!required || !applied) return false;
  const countBehind = applied.count !== null && applied.count < required.count;
  const headBehind = applied.head !== null && applied.head < required.head;
  return countBehind || headBehind;
}
