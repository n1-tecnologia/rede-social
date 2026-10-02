/**
 * The ONE rules renderer (UI-D-281): the sign-up sheet on `/cadastro`, the accept-invite sheet on
 * `/aceitar-convite` and the Regras editor's preview all render the tenant's rules through it, so what
 * the admin previews is, by construction, what a newcomer reads.
 *
 * Plain text: paragraphs split on a blank line (`\n{2,}`, unchanged since Phase 2), and inside a
 * paragraph a single line break is KEPT (white-space: pre-line), so a numbered list stays a list.
 * `[overflow-wrap:anywhere]` lets a long URL wrap inside the 320px sheet instead of widening it
 * (E14/overflow). Every block is React text: there is no raw-HTML path (T-08-38).
 *
 * Server-safe (no hooks, no `'use client'`): it renders inside client sheets and could equally render
 * on the server. The caller owns the container and its gap.
 */
export function RulesText({ rulesText }: { rulesText: string }) {
  const paragraphs = rulesText
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  // Stable keys without the array index: the block's opening plus how many earlier blocks opened the
  // same way (two identical paragraphs are legal rules text).
  const seen = new Map<string, number>();
  const keyed = paragraphs.map((block) => {
    const head = block.slice(0, 48);
    const n = (seen.get(head) ?? 0) + 1;
    seen.set(head, n);
    return { key: `${head}#${n}`, block };
  });

  return (
    <>
      {keyed.map(({ key, block }) => (
        <p
          key={key}
          className="whitespace-pre-line text-sm leading-relaxed text-text [overflow-wrap:anywhere]"
        >
          {block}
        </p>
      ))}
    </>
  );
}
