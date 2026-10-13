// Shareable URLs for the interface state: page, installation and selected asset.
// Paths are Spanish like the interface; nginx and Vite serve index.html for any of them.
export type Page = 'overview' | 'twin' | 'assets' | 'alerts' | 'settings';
export interface Route {
  page: Page;
  installationId: string;
  selectedAssetId: string | null;
}
const paths: Record<Page, string> = {
  overview: '/',
  twin: '/gemelo',
  assets: '/activos',
  alerts: '/alertas',
  settings: '/ajustes',
};
const pages = new Map(Object.entries(paths).map(([page, path]) => [path, page as Page]));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idParam = (params: URLSearchParams, name: string) => {
  const value = params.get(name);
  return value && uuid.test(value) ? value.toLowerCase() : null;
};
/** Reads a route from a URL path and query string. Unknown paths and malformed ids fall back. */
export function parseRoute(pathname: string, search: string): Route {
  const params = new URLSearchParams(search);
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return {
    page: pages.get(path) ?? 'overview',
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
