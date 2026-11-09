/**
 * 2026-10-23 (the product owner: every cover field shows the ideal size of its image): the ideal
 * pixel size of each kind of cover, read off where the app shows it. `CoverSizeHint` prints it
 * under the field.
 *
 * - Width: a landscape cover asks for 1600 px, the top of the cover ladder (`PURPOSE_WIDTHS.cover`,
 *   640 / 1080 / 1600): a wider file adds nothing on screen. A portrait or square one asks for the
 *   familiar 1080 px (the Instagram post), more than its largest place needs.
 * - Shape: the one of the place the cover is shown at. A cover shown in two shapes (a course: the
 *   3:4 poster of the catalogue and the wide band atop its page) asks for 4:3, the shape between
 *   them, so neither crop loses too much, and `alsoOtherShapes` adds the line asking to keep the
 *   subject in the middle. An event has one field per shape since 2026-10-24.
 */
export type CoverKind =
  | 'course'
  | 'courseCard'
  | 'courseBanner'
  | 'moduleCard'
  | 'moduleBanner'
  | 'track'
  | 'trackCard'
  | 'trackBanner'
  | 'live'
  | 'category'
  | 'community'
  | 'eventHero'
  | 'eventPoster'
  | 'product'
  | 'highlight';

export interface CoverSize {
  width: number;
  height: number;
  /** As people name it ("16:10", not the reduced "8:5"). */
  ratio: string;
  /** Also shown cropped to another shape: the hint asks to keep the subject in the middle. */
  alsoOtherShapes: boolean;
}

export const COVER_SIZES: Readonly<Record<CoverKind, CoverSize>> = {
  // The 3:4 catalogue poster, the 16:10 to 21:9 band atop the course and Início, the module bands.
  course: { width: 1600, height: 1200, ratio: '4:3', alsoOtherShapes: true },
  // 2026-10-27: the course form's two blocks ("faça o mesmo para cursos"): the 16:9 card of Cursos
  // and Início, and the 4:1 band atop the course's page, the SAME image's middle.
  courseCard: { width: 1600, height: 900, ratio: '16:9', alsoOtherShapes: false },
  courseBanner: { width: 1600, height: 400, ratio: '4:1', alsoOtherShapes: true },
  // 2026-10-27: the module popup's two blocks: the 16:9 module card of the course page, and the 4:1
  // band atop the module's page.
  moduleCard: { width: 1600, height: 900, ratio: '16:9', alsoOtherShapes: false },
  moduleBanner: { width: 1600, height: 400, ratio: '4:1', alsoOtherShapes: true },
  // The 16:10 card, panoramic (21:9) on the desktop's Início.
  track: { width: 1600, height: 1000, ratio: '16:10', alsoOtherShapes: true },
  // 2026-10-27: the track form's two blocks, one per place ("separe isso visualmente"): the 4:3
  // card of Início and Trilhas, and the 4:1 band atop the track's page, the SAME image's middle.
  trackCard: { width: 1600, height: 1200, ratio: '4:3', alsoOtherShapes: false },
  trackBanner: { width: 1600, height: 400, ratio: '4:1', alsoOtherShapes: true },
  // The 16:10 card and page, 2:1 to 21:9 on the desktop.
  live: { width: 1600, height: 1000, ratio: '16:10', alsoOtherShapes: true },
  // The 4:3 tile of "Explore por categoria", at most 200 px wide.
  category: { width: 1200, height: 900, ratio: '4:3', alsoOtherShapes: false },
  // The 16:7 list card; the community page's band is wider still.
  community: { width: 1600, height: 700, ratio: '16:7', alsoOtherShapes: true },
  // 2026-10-24: an event has a cover per shape: lying, the 16:10 card of its page...
  eventHero: { width: 1600, height: 1000, ratio: '16:10', alsoOtherShapes: false },
  // ...and standing, the 4:5 poster of the list.
  eventPoster: { width: 1080, height: 1350, ratio: '4:5', alsoOtherShapes: false },
  // The 4:5 card of the Loja and the product's page, the same shape in both.
  product: { width: 1080, height: 1350, ratio: '4:5', alsoOtherShapes: false },
  // The highlight's circle.
  highlight: { width: 1080, height: 1080, ratio: '1:1', alsoOtherShapes: true },
};
