import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// WCAG 2.1 A/AA checks with axe on every page, on desktop and on a phone. Cesium's own widget
// (the WebGL canvas and its credit logo) is third-party and left out.
const pages = ['/', '/gemelo', '/activos', '/alertas', '/ajustes'];
const sizes = [
  { name: 'escritorio', width: 1280, height: 900 },
  { name: 'móvil', width: 390, height: 844 },
];

for (const size of sizes)
  test(`no axe violations on any page (${size.name})`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize(size);
    const found: string[] = [];
    for (const path of pages) {
      await page.goto(path);
      await expect(page.getByTestId('connection')).toContainText('Tiempo real');
      if (path === '/gemelo')
        await expect(page.getByTestId('cesium-view')).toHaveAttribute('data-ready', 'true', {
          timeout: 30000,
        });
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
        .exclude('.cesium-viewer')
        .analyze();
      for (const violation of results.violations)
        for (const node of violation.nodes)
          found.push(
            `${path} ${violation.id}: ${node.target.join(' ')} ${node.failureSummary ?? ''}`,
          );
    }
    expect(found).toEqual([]);
  });
