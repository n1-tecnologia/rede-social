import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { notFound, redirect } from 'next/navigation';
import { TrackForm } from '@/app/(app)/cursos/trilhas/TrackForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { getTrack, listTrackFormCourses } from '@/lib/courses';
import { trackFormDefaults } from '@/lib/courses-view';

/**
 * `/cursos/trilhas/[trackId]` (08.3-10, D-415, UI-D-402, COURSE-10): the edit half of the SAME form —
 * the row the Trilhas tab links to (UI-D-392).
 *
 * **Permission first, then the read** (the loja posture): the gate of `cursos/layout.tsx` is repeated
 * here so a refused caller's request never fires the track read. Every miss is the school's one
 * not-found (an unknown, foreign or vanished track — the API answers one bare 404 for both, D-23); a
 * read FAILURE throws, so a form filled with blanks is never offered over a track that is fine. An
 * ARCHIVED track is still editable: its form shows the archived note instead of "Arquivar trilha".
 *
 * The form receives EVERY linked course with its CURRENT status (the admin read): a course that is no
 * longer published is drawn with the "Não publicado" pill and left out of the save (UI-D-402). The
 * picker lists the published catalogue (first 50).
 */
export default async function EditTrackPage({ params }: { params: Promise<{ trackId: string }> }) {
  const [{ trackId }, bootstrap] = await Promise.all([params, requireBootstrap()]);
  if (
    !bootstrap.modules.some((module) => module.key === 'courses') ||
    !bootstrap.permissions.includes(COURSE_PERMISSIONS.manage)
  ) {
    notFound();
  }

  const [result, courses] = await Promise.all([getTrack(trackId), listTrackFormCourses()]);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'disabled') notFound();
  if (result.status === 'not-found') notFound();
  if (result.status === 'error') throw new Error('courses.track_unavailable');

  return (
    <TrackForm
      mode="edit"
      trackId={result.track.id}
      initial={trackFormDefaults(result.track)}
      tenantName={bootstrap.tenant.displayName}
      courses={courses}
    />
  );
}
