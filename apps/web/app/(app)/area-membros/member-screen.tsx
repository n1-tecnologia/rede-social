import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { notFound } from 'next/navigation';
import { requireBootstrap } from '@/lib/bootstrap';
import type { MemberScreen } from '@/lib/member-area';
import { MemberCatalogue } from '../cursos/MemberCatalogue';

/** The query a member screen reads; `ver` is the manager's preview flag. */
export type MemberScreenParams = {
  categoria?: string | string[];
  /** 2026-10-26: the catalogue's front-only search. */
  busca?: string | string[];
  trilha?: string | string[];
  ver?: string | string[];
};

/**
 * 2026-10-22 — one member screen of the school area, the body of every `/area-membros*` page (one
 * page per screen since the courses redesign: Início, Cursos, Trilhas, Lives, Progresso).
 *
 *  - The module gate, repeated from `layout.tsx` because Next renders the layout and the page
 *    concurrently: without it a body read would fire (a guaranteed 404) before the layout's
 *    not-found lands. Same React-cached bootstrap, no second call.
 *  - The role split (T-k7x-01), on the composed `courses.manage` permission only: a `member` or a
 *    `support_tenant` gets the screen as it is (their `?ver=` is ignored). 2026-10-23 (the
 *    reference's model, the user's choice): a manager gets it TOO, with or without `?ver=aluno`, as
 *    a member sees it and writing nothing (`preview`), and manages through the menu's "Gerenciar".
 *    No manager is sent to the admin lists from here any more.
 *  - The render: `MemberCatalogue`, the frame, with the screen's body.
 */
export async function MemberScreenPage({
  screen,
  params,
}: {
  screen: MemberScreen;
  params: MemberScreenParams;
}) {
  const bootstrap = await requireBootstrap();
  if (!bootstrap.modules.some((module) => module.key === 'courses')) notFound();
  const manage = bootstrap.permissions.includes(COURSE_PERMISSIONS.manage);

  return (
    <MemberCatalogue
      screen={screen}
      categoria={params.categoria}
      busca={params.busca}
      trilha={params.trilha}
      tenantName={bootstrap.tenant.displayName}
      timeZone={bootstrap.tenant.timezone}
      preview={manage}
    />
  );
}
