import { MemberScreenPage, type MemberScreenParams } from '../member-screen';

/**
 * `/area-membros/cursos` (2026-10-22, one page per screen): the member's catalogue, every course of
 * the tenant as posters, filtered by `?categoria=` (the chips). The gate, the role split (a manager
 * without `?ver=aluno` goes to `/cursos`) and the frame are `member-screen.tsx`'s.
 */
export default async function MemberCoursesPage({
  searchParams,
}: {
  searchParams: Promise<MemberScreenParams>;
}) {
  return <MemberScreenPage screen="cursos" params={await searchParams} />;
}
