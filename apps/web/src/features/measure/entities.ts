import type { EntityCollection } from 'cesium';

/**
 * Starts redrawing every entity of a collection: removes them all with the collection's events on,
 * then suspends the events for the new ones (resume them when done). Removing and re-adding an
 * entity with the same id while the events are suspended cancels out: the visualizers never hear
 * of the new entity and keep drawing the old one, so later changes to its label (an offset, a
 * position) would never show.
 */
export function clearForRedraw(entities: EntityCollection) {
  entities.removeAll();
  entities.suspendEvents();
}
