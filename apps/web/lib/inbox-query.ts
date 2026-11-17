/**
 * The staff inbox's state, as it lives in the URL (UI-D-823, D-805, planner decision A-12.4-QS) [client-safe].
 *
 * `/suporte?aba=em-aberto|resolvidos|fechados&resp=eu|sem|{userId}&prio=alta|normal|baixa&aguardando=1`
 *
 * The URL vocabulary is the user's (pt-BR words in a shared link); the API's is `tab`, `owner`,
 * `priority`, `awaiting`. This module is the one place that maps between them, so a refetch, the
 * load-more action and a row link all agree. It is PURE (no server import, no clock), which lets the
 * client list and the tests use it directly.
 *
 * Every value is parsed to a closed enum or a canonical uuid; anything else falls back to its default
 * (T-12.4-64), so a crafted query can never reach the API or the SQL behind it. The toggle exists only on
 * "Em aberto" (UI-D-823, A-UI-28): it is dropped on the two other tabs, in the parse and in every write.
 * Nothing here decides which cases belong to a tab: the server filters, the client only renders.
 */

export const INBOX_TABS = ['em-aberto', 'resolvidos', 'fechados'] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

export const INBOX_PRIORITIES = ['alta', 'normal', 'baixa'] as const;
export type InboxPriority = (typeof INBOX_PRIORITIES)[number];

/**
 * The view the list shows. `owner` is `null` for Todos, `'eu'`, `'sem'` or a lower-case staff user id.
 * `priority` is `null` for Todas.
 */
export interface InboxQueryState {
  tab: InboxTab;
  owner: string | null;
  priority: InboxPriority | null;
  awaiting: boolean;
}

/** The default on entry: Em aberto, Todos, Todas, toggle off. */
export const INBOX_DEFAULTS: InboxQueryState = {
  tab: 'em-aberto',
  owner: null,
  priority: null,
  awaiting: false,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Anything with a `get(name)`: a `URLSearchParams` or Next's read-only copy of it. */
export interface InboxQuerySource {
  get(name: string): string | null;
}

const isTab = (value: string | null): value is InboxTab =>
  value !== null && (INBOX_TABS as readonly string[]).includes(value);

const isPriority = (value: string | null): value is InboxPriority =>
  value !== null && (INBOX_PRIORITIES as readonly string[]).includes(value);

/** The URL's view. An unknown value of any key is that key's default; the toggle is open-tab only. */
export function parseInboxQuery(source: InboxQuerySource): InboxQueryState {
  const tabRaw = source.get('aba');
  const tab: InboxTab = isTab(tabRaw) ? tabRaw : INBOX_DEFAULTS.tab;

  const ownerRaw = source.get('resp');
  let owner: string | null = null;
  if (ownerRaw === 'eu' || ownerRaw === 'sem') owner = ownerRaw;
  else if (ownerRaw !== null && UUID_RE.test(ownerRaw)) owner = ownerRaw.toLowerCase();

  const priorityRaw = source.get('prio');
  const priority: InboxPriority | null = isPriority(priorityRaw) ? priorityRaw : null;

  const awaiting = tab === 'em-aberto' && source.get('aguardando') === '1';
  return { tab, owner, priority, awaiting };
}

/** A tab change keeps the owner and the priority and drops the toggle away from "Em aberto". */
export function withInboxTab(state: InboxQueryState, tab: InboxTab): InboxQueryState {
  return { ...state, tab, awaiting: tab === 'em-aberto' ? state.awaiting : false };
}

/** True when an owner, a priority or the toggle is on: what "Limpar filtros" resets (a tab is not a filter). */
export function anyInboxFilter(state: InboxQueryState): boolean {
  return state.owner !== null || state.priority !== null || state.awaiting;
}

/** The query string (no leading `?`) of a view; the default view is the empty string. */
export function serializeInboxQuery(state: InboxQueryState): string {
  const search = new URLSearchParams();
  if (state.tab !== INBOX_DEFAULTS.tab) search.set('aba', state.tab);
  if (state.owner !== null) search.set('resp', state.owner);
  if (state.priority !== null) search.set('prio', state.priority);
  if (state.awaiting && state.tab === 'em-aberto') search.set('aguardando', '1');
  return search.toString();
}

/** `path` with the view's query: the bare path for the default view. */
export function inboxHref(path: string, state: InboxQueryState): string {
  const query = serializeInboxQuery(state);
  return query ? `${path}?${query}` : path;
}

/** The filters in the API's own vocabulary: what the load-more server action takes. */
export interface InboxApiFilters {
  tab: 'open' | 'resolved' | 'closed';
  owner?: string;
  priority?: 'high' | 'normal' | 'low';
  awaiting?: true;
}

const API_TAB: Record<InboxTab, InboxApiFilters['tab']> = {
  'em-aberto': 'open',
  resolvidos: 'resolved',
  fechados: 'closed',
};

const API_PRIORITY: Record<InboxPriority, NonNullable<InboxApiFilters['priority']>> = {
  alta: 'high',
  normal: 'normal',
  baixa: 'low',
};

/** The view as the API's `tab`, `owner`, `priority` and `awaiting`; only what is set is present. */
export function inboxApiFilters(state: InboxQueryState): InboxApiFilters {
  const filters: InboxApiFilters = { tab: API_TAB[state.tab] };
  if (state.owner !== null)
    filters.owner = state.owner === 'eu' ? 'me' : state.owner === 'sem' ? 'none' : state.owner;
  if (state.priority !== null) filters.priority = API_PRIORITY[state.priority];
  if (state.awaiting && state.tab === 'em-aberto') filters.awaiting = true;
  return filters;
}

/** The BFF query string of a view (`tab=resolved&owner=me&priority=high`, then `awaiting=1`). */
export function inboxApiQuery(state: InboxQueryState): string {
  const filters = inboxApiFilters(state);
  const search = new URLSearchParams();
  search.set('tab', filters.tab);
  if (filters.owner) search.set('owner', filters.owner);
  if (filters.priority) search.set('priority', filters.priority);
  if (filters.awaiting) search.set('awaiting', '1');
  return search.toString();
}
