export class IonLayerError extends Error {
  constructor(public readonly layer: 'terrain' | 'buildings') {
    super(
      layer === 'terrain'
        ? 'No se pudo cargar Cesium World Terrain. El token debe permitir lectura de Cesium World Terrain y Cesium OSM Buildings para esta URL.'
        : 'No se pudieron cargar los edificios OSM. Comprueba los permisos del token y la conexión.',
    );
  }
}

// Buildings keep their original world elevations. Only expose them after compatible terrain loads.
export async function loadIonEnvironment<TTerrain, TBuildings>(
  loadTerrain: () => Promise<TTerrain>,
  loadBuildings: () => Promise<TBuildings>,
): Promise<{ terrain: TTerrain; buildings: TBuildings }> {
  let terrain: TTerrain;
  try {
    terrain = await loadTerrain();
  } catch {
    throw new IonLayerError('terrain');
  }
  try {
    return { terrain, buildings: await loadBuildings() };
  } catch {
    throw new IonLayerError('buildings');
  }
}
