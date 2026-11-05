import { MemberScreenPage, type MemberScreenParams } from '../member-screen';

/**
 * `/area-membros/trilhas` (2026-10-22, one page per screen): the member's tracks, one at a time,
 * chosen by `?trilha=` among the server's. The gate, the role split (a manager without `?ver=aluno`
 * goes to `/cursos/trilhas`) and the frame are `member-screen.tsx`'s.
 */
export default async function MemberTracksPage({
  searchParams,
}: {
  searchParams: Promise<MemberScreenParams>;
}) {
  return <MemberScreenPage screen="trilhas" params={await searchParams} />;
}
