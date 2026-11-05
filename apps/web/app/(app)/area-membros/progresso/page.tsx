import { MemberScreenPage, type MemberScreenParams } from '../member-screen';

/**
 * `/area-membros/progresso` (2026-10-22, one page per screen): the member's own progress across the
 * tenant's courses. The gate, the role split (a manager without `?ver=aluno` goes to `/cursos`) and
 * the frame are `member-screen.tsx`'s.
 */
export default async function MemberProgressPage({
  searchParams,
}: {
  searchParams: Promise<MemberScreenParams>;
}) {
  return <MemberScreenPage screen="progresso" params={await searchParams} />;
}
