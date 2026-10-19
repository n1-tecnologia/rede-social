import CoursesLoading from '../cursos/loading';

/**
 * `/area-membros/loading.tsx`: the same role-neutral frame as `/cursos` (h1 and subtitle bars plus
 * the tabs row), so the member area shows no jump while the catalogue streams in.
 */
export default function MemberAreaLoading() {
  return <CoursesLoading />;
}
