import { daysBefore, PREVIEW_TODAY } from './owner-members';
import type { PostType } from './shared';

/**
 * The client's 61 feed posts of the last 30 days (quick 261012-tru D-07): the table behind the
 * level-4 member lists (what a member liked, commented on and saw) and the Conteúdo area (quick
 * 261013-h51). RAW DATA (MOD-02): ids, community ids, formats, ISO dates, short excerpts, counts and
 * media sizes (tenant content), never a UI sentence.
 *
 * The counts match the Conteúdo area: 22 / 25 / 8 / 6 per community (`byCommunity`) and 18 / 15 / 20
 * / 8 per format (`byFormat`); each of the four top posts is here with its date, format, community,
 * likes and comments. Likes and comments (`feed_posts.like_count` / `comment_count`, measured) add up
 * to 3.100 + 840 and to every `byCommunity` / `byFormat` interaction total, and each post has at least
 * as many as the roster members whose insights list it (`tests/owner-content.test.ts`). The dates do
 * not model the weekday and time-slot split of "Melhor dia e horário": the heatmap is its own
 * aggregate (a planner decision).
 *
 * Media follows `media_assets` and `feed_post_media`: a video's size and `duration_seconds` (up to
 * 90 s it is a vertical 1080×1920, longer a horizontal 1920×1080), a gallery's first image size and
 * how many images it has (1 = a photo, 2+ = a carousel, SPEC §2.3), none for text and link posts.
 */

export interface OwnerPostMedia {
  width: number;
  height: number;
}

export interface OwnerPost {
  id: string;
  communityId: string;
  type: PostType;
  /** ISO date it was published. */
  date: string;
  excerpt: string;
  likes: number;
  comments: number;
  /** The video's size or the gallery's first image size; null for text and link posts. */
  media: OwnerPostMedia | null;
  /** Videos only. */
  durationSeconds: number | null;
  /** Galleries only: how many images (1 = a photo). */
  cards: number | null;
}

type Media = Pick<OwnerPost, 'media' | 'durationSeconds' | 'cards'>;

const NONE: Media = { media: null, durationSeconds: null, cards: null };

/** A video: up to 90 s vertical (a phone recording), longer horizontal (a class or a live). */
function video(seconds: number): Media {
  const media = seconds <= 90 ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  return { media, durationSeconds: seconds, cards: null };
}

function gallery(cards: number, height: 1080 | 1350): Media {
  return { media: { width: 1080, height }, durationSeconds: null, cards };
}

const PHOTO = gallery(1, 1350);

/** `[communityId, days ago, format, excerpt, likes, comments, media]`, per community, newest last. */
const ROWS: readonly (readonly [string, number, PostType, string, number, number, Media])[] = [
  ['c-vip', 29, 'video', 'Aula 1 da mentoria: o ponto de partida de cada um', 81, 11, video(1800)],
  ['c-vip', 28, 'text', 'Boas-vindas à nova turma VIP', 32, 20, NONE],
  ['c-vip', 27, 'gallery', 'Fotos do primeiro encontro da turma VIP', 72, 18, gallery(6, 1350)],
  ['c-vip', 25, 'video', 'Aula 2 da mentoria: como montar a rotina da semana', 81, 11, video(1560)],
  ['c-vip', 24, 'link', 'Planilha de hábitos da mentoria para baixar', 13, 3, NONE],
  ['c-vip', 22, 'text', 'Desafio VIP: registre um hábito por dia até domingo', 31, 19, NONE],
  [
    'c-vip',
    21,
    'video',
    'Live exclusiva VIP: perguntas sobre a rotina da manhã',
    88,
    12,
    video(3000),
  ],
  ['c-vip', 19, 'gallery', 'Bastidores da gravação das aulas da mentoria', 54, 11, PHOTO],
  [
    'c-vip',
    18,
    'video',
    'Aula 3 da mentoria: prioridades e o que deixar para depois',
    119,
    16,
    video(1620),
  ],
  ['c-vip', 16, 'text', 'Mentoria em grupo: respostas às perguntas da última sessão', 32, 20, NONE],
  ['c-vip', 15, 'video', 'Aula 4 da mentoria: metas pequenas e possíveis', 102, 13, video(1440)],
  ['c-vip', 14, 'text', 'Desafio VIP: compartilhe sua manhã ideal em três passos', 34, 21, NONE],
  [
    'c-vip',
    12,
    'video',
    'Live exclusiva VIP: como retomar a rotina depois de uma pausa',
    93,
    12,
    video(3300),
  ],
  ['c-vip', 11, 'link', 'Material extra: modelo de agenda semanal para imprimir', 36, 8, NONE],
  [
    'c-vip',
    9,
    'video',
    'Aula 5 da mentoria: como lidar com os dias mais corridos',
    106,
    14,
    video(1500),
  ],
  ['c-vip', 8, 'gallery', 'Mapa da semana preenchido na mentoria em grupo', 63, 12, PHOTO],
  [
    'c-vip',
    6,
    'gallery',
    'Galeria: as manhãs ideais que vocês compartilharam',
    70,
    12,
    gallery(6, 1350),
  ],
  ['c-vip', 5, 'text', 'Resumo da mentoria em grupo de terça', 38, 24, NONE],
  [
    'c-vip',
    4,
    'video',
    'Aula 6 da mentoria: hábitos de pausa ao longo do dia',
    97,
    13,
    video(1680),
  ],
  ['c-vip', 3, 'gallery', 'Checklist da rotina noturna em imagens', 70, 18, gallery(6, 1350)],
  ['c-vip', 1, 'text', 'Desafio VIP: escreva as três prioridades de amanhã', 18, 12, NONE],
  ['c-vip', 0, 'video', 'Live exclusiva VIP: rotina de fim de semana', 18, 2, video(3120)],
  ['c-geral', 29, 'text', 'Boas-vindas aos novos membros da comunidade', 37, 23, NONE],
  ['c-geral', 28, 'link', 'Leitura da semana: um capítulo sobre rotina e descanso', 6, 2, NONE],
  [
    'c-geral',
    27,
    'video',
    'Três hábitos simples para começar a semana com foco',
    141,
    19,
    video(52),
  ],
  ['c-geral', 26, 'text', 'Recado da semana: obrigado pelas mensagens de vocês', 29, 19, NONE],
  ['c-geral', 25, 'gallery', 'O cenário montado para gravar as novas aulas', 67, 13, PHOTO],
  ['c-geral', 24, 'text', 'Dica rápida: prepare a semana no domingo à noite', 24, 16, NONE],
  ['c-geral', 23, 'link', 'Recomendação de leitura para o fim de semana', 24, 6, NONE],
  ['c-geral', 22, 'text', 'Uma pergunta da caixinha: como manter a constância?', 27, 17, NONE],
  [
    'c-geral',
    20,
    'video',
    'Como organizar a agenda sem lotar todos os horários',
    132,
    41,
    video(41),
  ],
  ['c-geral', 19, 'gallery', 'A mesa de trabalho de uma participante', 58, 12, PHOTO],
  ['c-geral', 17, 'text', 'Enquete: qual horário vocês preferem para as lives?', 32, 20, NONE],
  ['c-geral', 16, 'link', 'Artigo: por que começar pequeno funciona melhor', 15, 3, NONE],
  ['c-geral', 14, 'text', 'Respondendo comentários: rotina com filhos pequenos', 27, 18, NONE],
  ['c-geral', 13, 'video', 'Como evitar o excesso de tarefas no começo do dia', 104, 14, video(49)],
  [
    'c-geral',
    12,
    'gallery',
    'Galeria: os cadernos de planejamento da comunidade',
    72,
    18,
    gallery(4, 1080),
  ],
  ['c-geral', 11, 'text', 'Dica rápida: uma lista curta vale mais que uma longa', 34, 21, NONE],
  ['c-geral', 9, 'link', 'Podcast da semana: rotina e descanso', 19, 5, NONE],
  ['c-geral', 8, 'text', 'Um lembrete gentil: constância não é perfeição', 40, 20, NONE],
  ['c-geral', 7, 'gallery', 'Fotos da live de dúvidas de setembro', 72, 18, gallery(8, 1080)],
  ['c-geral', 5, 'text', 'O que vem por aí nas próximas semanas da comunidade', 31, 19, NONE],
  ['c-geral', 4, 'video', 'Bastidores: como eu preparo o conteúdo da semana', 96, 31, video(58)],
  ['c-geral', 3, 'link', 'Lista de ferramentas para organizar a semana', 15, 3, NONE],
  [
    'c-geral',
    2,
    'gallery',
    'Galeria: as metas de outubro de quem participa',
    56,
    14,
    gallery(5, 1080),
  ],
  ['c-geral', 1, 'text', 'Enquete: qual tema vocês querem na próxima live?', 17, 11, NONE],
  ['c-geral', 0, 'video', 'Live de dúvidas confirmada para quinta às 20h', 19, 3, video(35)],
  ['c-iniciantes', 29, 'text', 'Comece por aqui: como a comunidade funciona', 33, 21, NONE],
  ['c-iniciantes', 25, 'video', 'Primeiro passo: escolha um hábito só', 44, 6, video(64)],
  ['c-iniciantes', 21, 'text', 'Apresente-se: conte de onde você é e o que busca', 31, 19, NONE],
  [
    'c-iniciantes',
    17,
    'video',
    'Como usar a planilha de hábitos na primeira semana',
    75,
    10,
    video(270),
  ],
  [
    'c-iniciantes',
    13,
    'gallery',
    'Galeria: a primeira semana de quem acabou de chegar',
    60,
    15,
    gallery(5, 1350),
  ],
  ['c-iniciantes', 10, 'link', 'Guia para iniciantes: as perguntas mais comuns', 22, 4, NONE],
  ['c-iniciantes', 6, 'text', 'Dúvidas da primeira semana respondidas', 27, 18, NONE],
  [
    'c-iniciantes',
    2,
    'video',
    'Primeiros passos: montando a sua primeira rotina',
    40,
    5,
    video(72),
  ],
  [
    'c-eventos',
    28,
    'text',
    'Encontro de setembro: inscrições abertas e local confirmado',
    17,
    11,
    NONE,
  ],
  [
    'c-eventos',
    23,
    'gallery',
    'Encontro de setembro: as fotos da turma',
    44,
    11,
    gallery(10, 1080),
  ],
  ['c-eventos', 18, 'video', 'Live de dúvidas: a gravação já está disponível', 53, 7, video(3600)],
  [
    'c-eventos',
    11,
    'gallery',
    'Workshop de sábado: fotos do que fizemos juntos',
    44,
    11,
    gallery(7, 1350),
  ],
  ['c-eventos', 5, 'gallery', 'Aula aberta: a foto da turma no fim da aula', 50, 10, PHOTO],
  [
    'c-eventos',
    1,
    'gallery',
    'Encontro mensal: o local já está reservado para sábado',
    18,
    4,
    PHOTO,
  ],
];

/** The 61 posts, newest first (ties in the communities' order), ids `op-01`..`op-61`. */
export const ownerPostTable: readonly OwnerPost[] = ROWS.map((row, order) => ({ row, order }))
  .sort((a, b) => a.row[1] - b.row[1] || a.order - b.order)
  .map(({ row: [communityId, daysAgo, type, excerpt, likes, comments, media] }, i) => ({
    id: `op-${String(i + 1).padStart(2, '0')}`,
    communityId,
    type,
    date: daysBefore(PREVIEW_TODAY, daysAgo),
    excerpt,
    likes,
    comments,
    ...media,
  }));

/**
 * `[unanswered, oldest unanswered in hours]` of the posts whose comments the team left without an
 * answer (quick 261013-h51 D-06); every other post's comments are all answered. Over 24 h is
 * "Precisa de atenção"; a post younger than 2 days only ever waits under 24 h. It lives with the
 * posts because Conteúdo (`owner-content.ts`) and the roster's comments (`owner-member-lists.ts`)
 * both read it: the oldest unanswered comment sits exactly at `momentHoursAgo(hours)` (counted from
 * the sample's 23:00, quick 261013-uoi C-3), and no comment of the post is older.
 */
export const OWNER_POST_UNANSWERED: Readonly<Record<string, readonly [number, number]>> = {
  'op-02': [1, 3],
  'op-03': [2, 18],
  'op-04': [1, 9],
  'op-08': [3, 60],
  'op-12': [4, 110],
  'op-19': [9, 192],
  'op-24': [2, 250],
};
