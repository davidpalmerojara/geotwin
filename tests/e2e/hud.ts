import { expect, type Page } from '@playwright/test';

/*
 * Helpers for the floating HUD: open the scene, a section sheet (from the GeoTwin menu), the
 * Capas panel and its Fondo choice.
 */
export const map = (page: Page) => page.getByTestId('cesium-view');

/** Opens a path and waits until the viewer has started. */
export async function openScene(page: Page, path = '/gemelo') {
  await page.goto(path);
  await expect(map(page)).toHaveAttribute('data-ready', 'true', { timeout: 60000 });
  return map(page);
}

/** The menu's button: «GeoTwin» on desktop, «Menú» on a phone. */
export const menuButton = (page: Page) => page.getByRole('button', { name: /^(GeoTwin|Menú)$/ });

/** Opens a section sheet from the GeoTwin menu (as a user would). */
export async function openSheet(
  page: Page,
  name: 'Gemelo' | 'Resumen' | 'Activos' | 'Alertas' | 'Ajustes',
) {
  await menuButton(page).click();
  await page
    .getByRole('navigation', { name: 'Secciones' })
    .getByRole('button', { name, exact: true })
    .click();
  if (name !== 'Gemelo')
    await expect(
      page.getByTestId('section-sheet').getByRole('heading', { name, exact: true }),
    ).toBeVisible();
}

/**
 * A panel (Capas, Medir, Radio) by name: a region beside the scene, or on a phone a sheet, which
 * is a modal dialog while it covers 90 % of the screen.
 */
export const panel = (page: Page, name: string) =>
  page
    .getByRole('region', { name, exact: true })
    .or(page.getByRole('dialog', { name, exact: true }));

/** The Capas panel, opened with its button if it is closed. */
export async function openCapas(page: Page) {
  const button = page.getByRole('button', { name: 'Capas', exact: true });
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  return panel(page, 'Capas');
}

/** Chooses the base under the clouds in Capas › Fondo. */
export async function chooseBase(page: Page, label: 'Ortofoto PNOA' | 'Neutro' | 'Natural Earth') {
  const panel = await openCapas(page);
  await panel
    .getByRole('group', { name: 'Fondo' })
    .getByRole('button', { name: label, exact: true })
    .click();
}

/** The name of what the scene's ground is made of, in the credits plate. */
export const mapBase = (page: Page) => page.getByTestId('map-base');

/** The asset card. */
export const card = (page: Page) => page.getByTestId('asset-card');

export const LIDAR_CREDIT = 'Obra derivada de LiDAR-PNOA-cob3 2022-2025 CC-BY 4.0 scne.es';

/**
 * Every credit character that something covers, and how many are on screen. Without LiDAR layers
 * in the database the PNOA-LiDAR credit is added as a plain line next to the viewer's own credits,
 * so the longest credits the scene shows are always there. A character counts as covered when it is
 * off screen, when another element is on top of it, or when it lies under the box of any other
 * plate, panel, sheet or card of the HUD (notes that let clicks through are invisible to
 * elementFromPoint, so the boxes are checked as well).
 */
export async function coveredCredits(page: Page) {
  const credits = page.getByTestId('credits');
  await page.evaluate((credit) => {
    const plate = document.querySelector('[data-testid="credits"]')!;
    if (plate.textContent?.includes('LiDAR-PNOA')) return;
    const line = document.createElement('span');
    line.textContent = ` • ${credit}`;
    // Next to Cesium's own credits, outside the container it redraws.
    (plate.querySelector('.credits-slot') ?? plate).append(line);
  }, LIDAR_CREDIT);
  await expect(credits).toContainText('LiDAR-PNOA-cob3');
  await expect(credits).toContainText('telemetría simulada');
  // Plates move as the credits wrap: let one layout pass settle.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
  return page.evaluate(() => {
    const plate = document.querySelector('[data-testid="credits"]')!;
    // Plates hidden behind a modal sheet (visibility: hidden) cover nothing.
    const boxes = [...document.querySelectorAll('[data-map-overlay], .edge-chip, .menu')]
      .filter((el) => el !== plate && !plate.contains(el) && !el.contains(plate))
      .filter((el) => el.checkVisibility({ visibilityProperty: true }))
      .map((el) => ({ s: el.className || el.tagName, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0);
    const walker = document.createTreeWalker(plate, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const covered: string[] = [];
    let shown = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      for (let i = 0; i < text.length; i++) {
        if (!text[i]!.trim()) continue;
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getBoundingClientRect();
        if (!r.width) continue;
        shown++;
        const x = r.left + r.width / 2,
          y = r.top + r.height / 2;
        const top = document.elementFromPoint(x, y);
        const by =
          x < 0 || x > innerWidth || y < 0 || y > innerHeight
            ? 'off screen'
            : !top || !plate.contains(top)
              ? String(top?.className || top?.tagName)
              : boxes.find(
                  ({ r: b }) =>
                    r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top,
                )?.s;
        if (by) covered.push(`${text[i]} (${by})`);
      }
    }
    return { shown, covered };
  });
}
