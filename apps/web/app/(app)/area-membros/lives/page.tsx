import { MemberScreenPage, type MemberScreenParams } from '../member-screen';

/**
 * `/area-membros/lives` (2026-10-22, one page per screen): the member's lives, the coming ones and
 * the recorded ones. The gate, the role split (a manager without `?ver=aluno` goes to
 * `/cursos/lives`) and the frame are `member-screen.tsx`'s. The live's own page stays
 * `/cursos/lives/{id}` (the address notifications and pushes carry).
 */
export default async function MemberLivesPage({
  searchParams,
}: {
  searchParams: Promise<MemberScreenParams>;
}) {
  return <MemberScreenPage screen="lives" params={await searchParams} />;
}
