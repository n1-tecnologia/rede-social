/**
 * `/eventos/novo` without `events.event.manage` renders the events module's ONE not-found screen
 * (UI E01/error), the same one every miss on `/eventos/[eventId]` lands on, rather than Next's bare
 * default. A member typing the URL cannot tell "no such page" from "not for you".
 */
export { default } from '../[eventId]/not-found';
