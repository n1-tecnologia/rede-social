/**
 * D-222: the only thing a member ever learns about the staff member who answered is their FIRST
 * NAME: the first whitespace-separated token of the agent's display name in this tenant. Anything
 * else (a surname, the avatar, the e-mail, the role, the user id) stays on the server.
 *
 * `null`, `undefined`, an empty or whitespace-only name gives `''`, which the web renders as the team
 * alone ("Equipe {tenant}").
 */
export function firstNameOf(displayName: string | null | undefined): string {
  if (!displayName) return '';
  const [first] = displayName.trim().split(/\s+/u);
  return first ?? '';
}
