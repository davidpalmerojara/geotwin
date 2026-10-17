// Shareable URLs for the interface state: the section sheet open over the scene, the installation
// and the selected asset. Paths are Spanish like the interface; nginx and Vite serve index.html
// for any of them. The scene is always there: /gemelo is the scene with no sheet open, and the
// root path leads to it (the old home page, Resumen, now lives at /resumen as a sheet).
export type Page = 'overview' | 'twin' | 'assets' | 'alerts' | 'settings';
/** A section sheet: every page except the bare scene. */
export type Sheet = Exclude<Page, 'twin'>;
export interface Route {
  page: Page;
  installationId: string;
  selectedAssetId: string | null;
}
const paths: Record<Page, string> = {
  twin: '/gemelo',
  overview: '/resumen',
  assets: '/activos',
  alerts: '/alertas',
  settings: '/ajustes',
};
export const pageTitle: Record<Page, string> = {
  twin: 'Gemelo',
  overview: 'Resumen',
  assets: 'Activos',
  alerts: 'Alertas',
  settings: 'Ajustes',
};
const pages = new Map(Object.entries(paths).map(([page, path]) => [path, page as Page]));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idParam = (params: URLSearchParams, name: string) => {
  const value = params.get(name);
  return value && uuid.test(value) ? value.toLowerCase() : null;
};
/**
 * Reads a route from a URL path and query string. The root and unknown paths open the scene;
 * malformed ids are dropped. Links from before the sheets (/gemelo?instalacion=…&activo=…)
 * keep working.
 */
export function parseRoute(pathname: string, search: string): Route {
  const params = new URLSearchParams(search);
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return {
    page: pages.get(path) ?? 'twin',
    installationId: idParam(params, 'instalacion') ?? '',
    selectedAssetId: idParam(params, 'activo'),
  };
}
/** The URL (path and query) that represents a route. */
export function routeUrl(route: Route) {
  const params = new URLSearchParams();
  if (route.installationId) params.set('instalacion', route.installationId);
  if (route.selectedAssetId) params.set('activo', route.selectedAssetId);
  const query = params.toString();
  return `${paths[route.page]}${query ? `?${query}` : ''}`;
}
