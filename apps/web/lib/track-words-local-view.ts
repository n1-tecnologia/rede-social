import type { LearnTracks } from '@rede-social/module-courses/contracts';
import { getTrack } from '@/lib/courses';
import type { LearnReadResult } from '@/lib/courses-learn';

/**
 * ⚠ TEMPORARY LOCAL VIEW (2026-10-27). REMOVE this file and its two calls (`MemberTracksTab`,
 * `MemberHomeTab`: `.then((read) => withTrackWordsLocalView(read, preview))`) when the product owner
 * says "ok" — his words: "coloque lá no card para apenas eu ver como fica sem mexer em api, mantenha
 * tudo preparado para receber como já está, porém quero ter só uma view local aqui e quando eu disser
 * ok você pode tirar essa view e voltar para o estado atual".
 *
 * The member read (`GET /v1/courses/learn/tracks`) does not carry a track's subtitle, audience and
 * description yet, while the screens are ready for them (`LearnTrack`'s optional fields). For a
 * MANAGER only (the member area's preview), this borrows them from the admin read each track already
 * has (`GET /v1/courses/tracks/{id}`, `courses.manage`), so he sees the cards and the track's page
 * with his words. A member never reaches it (no preview, and the admin read refuses him anyway); a
 * failed admin read leaves the track as the member read sent it. No API, no database touched.
 */
export async function withTrackWordsLocalView(
  read: LearnReadResult<LearnTracks>,
  manager: boolean,
): Promise<LearnReadResult<LearnTracks>> {
  if (!manager || read.status !== 'ok') return read;
  const details = await Promise.all(read.page.tracks.map((track) => getTrack(track.id)));
  return {
    status: 'ok',
    page: {
      ...read.page,
      tracks: read.page.tracks.map((track, index) => {
        const detail = details[index];
        if (detail?.status !== 'ok') return track;
        return {
          ...track,
          subtitle: detail.track.subtitle,
          audience: detail.track.audience,
          description: detail.track.description,
        };
      }),
    },
  };
}
