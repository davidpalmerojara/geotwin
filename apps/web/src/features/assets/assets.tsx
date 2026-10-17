import { useState } from 'react';
import { Search } from 'lucide-react';
import { useAssets, useInstallations } from '../../hooks/data';
import { useUI } from '../../stores/ui';
import { Status, Loading, ErrorState, Empty } from '../../components/common';
import { assetTypeLabel, count, number } from '../../lib/format';
import { formatLatLon } from '../hud/readout';

/** Accents and capitals do not matter when searching («sonda» finds «Sonda», «deposito» «Depósito»). */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Activos: the inventory as a table (name, installation, state, position and mounting height),
 * with a search and a state filter. The name opens the asset in the scene.
 */
export function Assets() {
  const assets = useAssets(),
    installations = useInstallations(),
    select = useUI((s) => s.selectAsset),
    setPage = useUI((s) => s.setPage);
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState('');
  const visible = assets.data?.filter(
    (a) => fold(a.name).includes(fold(search)) && (!status || a.status === status),
  );
  return (
    <div className="page">
      <p className="sheet-lede">
        Los activos de la escena. El nombre abre su ficha y lleva la cámara hasta él.
      </p>
      <div className="sheet-tools">
        <label className="search-box">
          <Search size={14} aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar inventario"
            placeholder="Buscar por nombre…"
          />
        </label>
        <select
          aria-label="Filtrar estado"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Todos los estados</option>
          <option value="healthy">Operativo</option>
          <option value="warning">Advertencia</option>
          <option value="critical">Crítico</option>
        </select>
        <span className="f1" role="status">
          {visible ? count(visible.length, 'activo', 'activos') : '—'}
        </span>
      </div>
      {assets.isPending ? (
        <Loading />
      ) : assets.isError ? (
        <ErrorState error={assets.error} retry={() => void assets.refetch()} />
      ) : !visible?.length ? (
        <Empty />
      ) : (
        <table className="data data-stack">
          <thead>
            <tr>
              <th scope="col">Activo</th>
              <th scope="col">Instalación</th>
              <th scope="col">Estado</th>
              <th scope="col">Posición</th>
              <th scope="col" className="c-r">
                Montaje
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => (
              <tr key={a.id}>
                <td>
                  <button
                    type="button"
                    className="row-link"
                    onClick={() => {
                      select(a.id);
                      setPage('twin');
                    }}
                  >
                    {a.name}
                  </button>
                  <small className="f1">
                    {assetTypeLabel[a.type]} · <span className="num">#{a.id.slice(-4)}</span>
                  </small>
                </td>
                <td className="f1" data-label="Instalación">
                  {installations.data?.find((i) => i.id === a.installation_id)?.name ?? '—'}
                </td>
                <td data-label="Estado">
                  <Status status={a.status} />
                </td>
                <td className="num" data-label="Posición">
                  {formatLatLon(a.location.lat, a.location.lng)}
                </td>
                <td className="num c-r" data-label="Montaje">
                  {a.mount_height_m > 0 ? `${number(a.mount_height_m, 1)} m` : 'a ras de suelo'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
