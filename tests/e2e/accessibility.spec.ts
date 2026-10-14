import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// WCAG 2.1 A/AA checks with axe on every page, on desktop and on a phone, with an active
// incident (alert cards) and with an asset open in the inspector. Cesium's own widget (the WebGL
// canvas and its credit logo) is third-party and left out.
const pages = ['/', '/gemelo', '/activos', '/alertas', '/ajustes'];
const sizes = [
  { name: 'escritorio', width: 1280, height: 900 },
  { name: 'móvil', width: 390, height: 844 },
];
// A fixture asset not used by the other specs.
const assetId = '20000000-0000-4000-8000-000000000002';

async function violations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .exclude('.cesium-viewer')
    .analyze();
  return results.violations.flatMap((violation) =>
    violation.nodes.map(
      (node) => `${label} ${violation.id}: ${node.target.join(' ')} ${node.failureSummary ?? ''}`,
    ),
  );
}

for (const size of sizes)
  test(`no axe violations on any page (${size.name})`, async ({ page, request }) => {
    test.setTimeout(150000);
    const created = await request.post('/api/alerts', {
      data: { asset_id: assetId, severity: 'warning', message: 'Revisión de accesibilidad (E2E)' },
    });
    expect(created.status()).toBe(201);
    const alert = await created.json();
    try {
      await page.setViewportSize(size);
      const found: string[] = [];
      for (const path of pages) {
        await page.goto(path);
        await expect(page.getByTestId('connection')).toContainText('Tiempo real');
        if (path === '/gemelo')
          await expect(page.getByTestId('cesium-view')).toHaveAttribute('data-ready', 'true', {
            timeout: 30000,
          });
        found.push(...(await violations(page, path)));
      }
      // The asset inspector with its sensors, readings and the open incident.
      await page.goto(`/gemelo?activo=${assetId}`);
      await expect(page.getByRole('heading', { name: 'Sensores del activo' })).toBeVisible();
      found.push(...(await violations(page, 'inspector')));
      expect(found).toEqual([]);
    } finally {
      await request.patch(`/api/alerts/${alert.id}/resolve`);
    }
  });
