import { test } from 'playwright/test';
import { expectUI } from 'lintapple/playwright';

test('project page follows the UI policy', async ({ page }, testInfo) => {
  await page.goto(new URL('../good.html', import.meta.url).href);
  await expectUI(page, testInfo);
});
