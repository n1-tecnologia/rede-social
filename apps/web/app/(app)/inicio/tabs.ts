/**
 * RED stub (09-08 Task 1): deliberately inert so the tests above fail on an ASSERTION, not on a
 * missing module. Fully replaced in the GREEN commit.
 */
export const INICIO_TABS = [] as const;
export type InicioTab = 'inicio' | 'explorar';
export const DEFAULT_INICIO_TAB: InicioTab = 'inicio';
export function inicioTabFromParam(_value: string | string[] | undefined): InicioTab {
  return 'inicio';
}
export function inicioTabHref(_key: InicioTab): string {
  return '';
}
export function showsInicioTabs(
  _permissions: readonly string[],
  _modules: ReadonlyArray<{ key: string }>,
): boolean {
  return false;
}
