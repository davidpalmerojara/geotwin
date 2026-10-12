import { describe, expect, it, vi } from 'vitest';
import { IonLayerError, loadIonEnvironment } from './ion-environment';

describe('Compatible ion environment', () => {
  it('does not request buildings when terrain permission is denied', async () => {
    const buildings = vi.fn(async () => ({ id: 'buildings' }));
    await expect(
      loadIonEnvironment(async () => {
        throw new Error('403');
      }, buildings),
    ).rejects.toMatchObject({ layer: 'terrain' });
    expect(buildings).not.toHaveBeenCalled();
  });
  it('waits for terrain before loading buildings', async () => {
    const order: string[] = [];
    const result = await loadIonEnvironment(
      async () => {
        order.push('terrain');
        return { id: 'world-terrain' };
      },
      async () => {
        order.push('buildings');
        return { id: 'osm' };
      },
    );
    expect(order).toEqual(['terrain', 'buildings']);
    expect(result.terrain.id).toBe('world-terrain');
    expect(result.buildings.id).toBe('osm');
  });
  it('does not return a partial environment when buildings fail', async () => {
    await expect(
      loadIonEnvironment(
        async () => 'terrain',
        async () => {
          throw new Error('network');
        },
      ),
    ).rejects.toBeInstanceOf(IonLayerError);
    await expect(
      loadIonEnvironment(
        async () => 'terrain',
        async () => {
          throw new Error('network');
        },
      ),
    ).rejects.toMatchObject({ layer: 'buildings' });
  });
});
