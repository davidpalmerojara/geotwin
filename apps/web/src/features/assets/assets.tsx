import { useState } from 'react';
import { Search, ArrowUpRight, Box } from 'lucide-react';
import { useAssets, useInstallations } from '../../hooks/data';
import { useUI } from '../../stores/ui';
import { Status, Loading, ErrorState, Empty, SectionHeading } from '../../components/common';
import { Button } from '../../components/ui/button';
import { assetTypeLabel, count } from '../../lib/format';
export function Assets() {
  const assets = useAssets(),
    installations = useInstallations(),
    select = useUI((s) => s.selectAsset),
    setPage = useUI((s) => s.setPage);
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState('');
  const visible = assets.data?.filter(
    (a) => a.name.toLowerCase().includes(search.toLowerCase()) && (!status || a.status === status),
  );
  return (
    <div className="page">
      <SectionHeading
        eyebrow="INVENTARIO / ACTIVOS"
        title="El inventario de tu red"
        description="Activos geolocalizados y estados operativos compartidos con el gemelo digital."
      />
      <section className="panel">
        <div className="table-toolbar">
          <label className="search-box">
            <Search size={16} />
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
          <span className="text-xs text-slate-400">
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
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Activo</th>
                  <th>Instalación</th>
                  <th>Estado</th>
                  <th>Coordenadas WGS84</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div className="cell-name">
                        <Box size={17} />
                        <div>
                          <strong>{a.name}</strong>
                          <small>
                            {assetTypeLabel[a.type]} · #{a.id.slice(-4)}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>
                      {installations.data?.find((i) => i.id === a.installation_id)?.name ?? '—'}
                    </td>
                    <td>
                      <Status status={a.status} />
                    </td>
                    <td className="font-mono text-xs">
                      {a.location.lat.toFixed(5)}, {a.location.lng.toFixed(5)}
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          select(a.id);
                          setPage('twin');
                        }}
                      >
                        Inspeccionar
                        <ArrowUpRight size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
