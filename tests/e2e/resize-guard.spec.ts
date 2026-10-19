import { test, expect } from './fixtures';

/*
 * The «ResizeObserver loop» guard of fixtures.ts watches every page the test's context opens,
 * not only `page`: a second page (like demo.spec's observer) that raises the error is caught.
 */
test('the ResizeObserver guard also hears a second page of the context', async ({
  context,
  resizeLoops,
}) => {
  const other = await context.newPage();
  await other.goto('/api/health');
  // An element that changes its own size inside its observer's callback: the browser gives up
  // on the rest of the notifications and reports the loop as a window error.
  await other.evaluate(() => {
    const box = document.createElement('div');
    document.body.append(box);
    let n = 0;
    new ResizeObserver(() => {
      n += 1;
      if (n < 4) box.style.height = `${10 + n * 10}px`;
    }).observe(box);
  });
  await expect.poll(() => resizeLoops.length).toBeGreaterThan(0);
  expect(resizeLoops[0]).toMatch(/ResizeObserver loop.*\/api\/health/);
  await other.close();
  // Raised on purpose: the guard's own check at the end of the test must not fail on it.
  resizeLoops.length = 0;
});
