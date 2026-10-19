/**
 * The member side of the school area (user decision 2026-10-19, quick 261019-k7x).
 *
 * The member's "area de membros" (Inicio, Cursos, Trilhas, Lives, Progresso) lives at
 * `/area-membros`. `/cursos` stays the admin hub (authoring) and the shared detail routes
 * (`/cursos/{id}`, `/cursos/{id}/aulas/{lessonId}`, `/cursos/lives/{id}`). `/membros` must NEVER be
 * used for this: it is the staff-only member directory.
 *
 * A zero-dependency leaf on purpose: client components (ReminderToggle) and the server layout import
 * it without pulling the view layer.
 */
export const MEMBER_AREA_PATH = '/area-membros';
