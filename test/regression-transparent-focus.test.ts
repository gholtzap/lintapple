import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { checkInteractions } from '../src/index.js';
import { html } from './audit-cases.js';

test('B025: transparent outlines do not prove a visible focus indicator', async () => {
  const browser = await chromium.launch();
  await mkdir('test-results', { recursive: true });
  try {
    for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark'] as const) {
      for (const [name, color, expected] of [['transparent', 'transparent', 'unresolved'], ['zero alpha', 'color(srgb 0 0 0 / 0)', 'unresolved'], ['blue', 'blue', 'passed']] as const) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
        try {
          await page.setContent(html(`button{outline:none;border:1px solid #111;padding:8px}button:focus-visible{outline:3px solid ${color}}`, '<button id="subject">Save changes</button>'));
          const before = await page.screenshot();
          const report = await checkInteractions(page, { focus: [{ selector: '#subject' }], timeout: 150 });
          assert.equal(report.checks.find(c => c.rule === 'focus-visible')?.status, expected, name);
          if (expected === 'unresolved') assert.ok(before.equals(await page.screenshot()), name);
          await writeFile(`test-results/b025-${name}-${width}-${colorScheme}.json`, JSON.stringify(report, null, 2));
        } finally { await page.close(); }
      }
    }
  } finally { await browser.close(); }
});
