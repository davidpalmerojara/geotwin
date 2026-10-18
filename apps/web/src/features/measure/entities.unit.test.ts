import { describe, expect, it } from 'vitest';
import { Cartesian3, Entity, EntityCollection } from 'cesium';
import { clearForRedraw } from './entities';

/** What a visualizer hears: the entities added and removed, as objects. */
function listen(collection: EntityCollection) {
  const heard = { added: [] as Entity[], removed: [] as Entity[] };
  collection.collectionChanged.addEventListener((_c, added: Entity[], removed: Entity[]) => {
    heard.added.push(...added);
    heard.removed.push(...removed);
  });
  return heard;
}
const label = (id: string, y: number) => ({
  id,
  position: Cartesian3.fromDegrees(-4.7256, 41.5878, 700),
  label: { text: 'E3 · 3,5 m', pixelOffset: { x: 10, y } as never },
});

describe('redrawing entities with the same ids', () => {
  it('lets the visualizers hear of the new entity, not keep the old one', () => {
    const collection = new EntityCollection();
    const first = collection.add(label('perfil:altura:etiqueta:2:0', 0));
    const heard = listen(collection);
    clearForRedraw(collection);
    const second = collection.add(label('perfil:altura:etiqueta:2:0', -25));
    collection.resumeEvents();
    expect(heard.removed).toContain(first);
    expect(heard.added).toContain(second);
  });
  it('is needed: suspending first and then removing cancels out (what the profile did)', () => {
    const collection = new EntityCollection();
    collection.add(label('perfil:altura:etiqueta:2:0', 0));
    const heard = listen(collection);
    collection.suspendEvents();
    collection.removeAll();
    const second = collection.add(label('perfil:altura:etiqueta:2:0', -25));
    collection.resumeEvents();
    expect(heard.added).not.toContain(second);
  });
});
