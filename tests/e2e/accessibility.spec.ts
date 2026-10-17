import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// WCAG 2.1 A/AA checks with axe on the scene and every section sheet, on desktop and on a phone,
// with an active incident (alert cards), with Capas open and with an asset card open. Cesium's own
// widget (the WebGL canvas) is third-party and left out; its credits, now in the credits plate,
// are checked.
const pages = ['/gemelo', '/resumen', '/activos', '/alertas', '/ajustes'];
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
        await expect(page.getByTestId('cesium-view')).toHaveAttribute('data-ready', 'true', {
          timeout: 30000,
        });
        if (path !== '/gemelo') await expect(page.getByTestId('section-sheet')).toBeVisible();
        found.push(...(await violations(page, path)));
      }
      // The Capas panel.
      await page.goto('/gemelo');
      await page.getByRole('button', { name: 'Capas', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Capas', exact: true })).toBeVisible();
      found.push(...(await violations(page, 'capas')));
      // The asset card with its sensors, readings and the open incident.
      await page.goto(`/gemelo?activo=${assetId}`);
      await expect(page.getByTestId('asset-card').getByTestId('meter').first()).toBeVisible();
      found.push(...(await violations(page, 'ficha')));
      expect(found).toEqual([]);
    } finally {
      await request.patch(`/api/alerts/${alert.id}/resolve`);
    }
  });
