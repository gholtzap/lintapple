import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { checkPage } from '../src/index.js';

const shell = (style: string) => `<!doctype html><html lang="en"><style>html{background:white;color:#111;font:16px system-ui}body{margin:24px}button{font:16px system-ui;min-height:40px;padding:8px}svg{display:block}text{font:16px system-ui;fill:#111}</style><body><button onclick="document.body.dataset.bold='true';document.querySelector('#label').style.setProperty('font-weight','700','important')">Use bold</button><svg width="300" height="100"><rect width="300" height="100" fill="white"/><text id="label" x="20" y="50" ${style ? `style="${style}"` : ''}>Chart label</text></svg></body></html>`;

test('page checks preserve application style updates during SVG measurement', async () => {
  const browser = await chromium.launch();
  try {
    await mkdir('test-results', { recursive: true });
    for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark'] as const) for (const style of ['', 'fill:#111 !important;opacity:1 !important']) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, colorScheme });
      try {
        await page.setContent(shell(style));
        const pending = checkPage(page);
        void pending.catch(() => {});
        await page.waitForFunction(() => document.querySelector<SVGTextElement>('#label')!.style.opacity === '0');
        await page.getByRole('button', { name: 'Use bold', exact: true }).click();
        const report = await pending;
        const after = await page.locator('#label').evaluate(el => ({
          applied: document.body.dataset.bold,
          weight: getComputedStyle(el).fontWeight,
          priority: el.style.getPropertyPriority('font-weight'),
          fill: el.style.getPropertyValue('fill'),
          opacity: el.style.getPropertyValue('opacity'),
          fillOpacity: el.style.getPropertyValue('fill-opacity'),
        }));
        await writeFile(`test-results/svg-style-${width}-${colorScheme}-${style ? 'inline' : 'css'}.json`, JSON.stringify({ report, after }, null, 2));
        assert.deepEqual(report.findings, []);
        assert.equal(after.applied, 'true');
        assert.equal(after.weight, '700');
        assert.equal(after.priority, 'important');
        assert.equal(after.fill, style ? 'rgb(17, 17, 17)' : '');
        assert.equal(after.opacity, style ? '1' : '');
        assert.equal(after.fillOpacity, '');
        await page.setContent(shell(style));
        const before = await page.content();
        assert.deepEqual((await checkPage(page)).findings, []);
        // axe can leave an empty style attribute when the element had none.
        if (style) assert.equal(await page.content(), before, 'Existing inline style text must remain exact.');
        else assert.equal(await page.locator('#label').evaluate(el => el.style.length), 0);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});

test('SVG capture errors restore paint without losing application updates', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(shell('fill:#111 !important'));
    const screenshot = page.screenshot.bind(page);
    page.screenshot = async () => {
      await page.getByRole('button', { name: 'Use bold', exact: true }).click();
      throw new Error('Capture interrupted');
    };
    try {
      const report = await checkPage(page);
      assert.ok(report.findings.some(f => f.status === 'unresolved' && f.actual.includes('Capture interrupted')));
      assert.equal(await page.locator('#label').evaluate(el => getComputedStyle(el).fontWeight), '700');
      assert.equal(await page.locator('#label').evaluate(el => el.style.getPropertyPriority('fill')), 'important');
      assert.equal(await page.locator('#label').evaluate(el => el.style.opacity), '');
    } finally { page.screenshot = screenshot; }
  } finally { await browser.close(); }
});
