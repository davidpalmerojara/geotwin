import { describe, expect, it } from 'vitest';
import { parseRoute, routeUrl, type Route } from './route';
const installation = '10000000-0000-4000-8000-000000000001';
const asset = '20000000-0000-4000-8000-000000000001';
describe('shareable routes', () => {
  it('writes page, installation and asset into a Spanish path and query', () => {
    expect(routeUrl({ page: 'twin', installationId: installation, selectedAssetId: asset })).toBe(
      `/gemelo?instalacion=${installation}&activo=${asset}`,
    );
    expect(routeUrl({ page: 'overview', installationId: '', selectedAssetId: null })).toBe('/');
    expect(routeUrl({ page: 'alerts', installationId: '', selectedAssetId: asset })).toBe(
      `/alertas?activo=${asset}`,
    );
  });
  it('reads back every route it writes', () => {
    const routes: Route[] = [
      { page: 'overview', installationId: '', selectedAssetId: null },
      { page: 'twin', installationId: installation, selectedAssetId: asset },
      { page: 'assets', installationId: installation, selectedAssetId: null },
      { page: 'alerts', installationId: '', selectedAssetId: asset },
      { page: 'settings', installationId: '', selectedAssetId: null },
    ];
    for (const route of routes) {
      const url = new URL(routeUrl(route), 'http://localhost');
      expect(parseRoute(url.pathname, url.search)).toEqual(route);
    }
  });
  it('falls back on unknown paths and ignores malformed ids', () => {
    expect(parseRoute('/no-existe', '?instalacion=1;DROP&activo=abc')).toEqual({
      page: 'overview',
      installationId: '',
      selectedAssetId: null,
    });
  });
  it('accepts a trailing slash and upper-case ids', () => {
    expect(parseRoute('/gemelo/', `?activo=${asset.toUpperCase()}`)).toEqual({
      page: 'twin',
      installationId: '',
      selectedAssetId: asset,
    });
  });
});
