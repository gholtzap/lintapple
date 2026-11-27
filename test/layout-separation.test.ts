import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { checkPage, validatePolicy } from '../src/index.js';

const rule = { selector: '.card', before: '.artwork', after: '.caption', axis: 'vertical', minGap: 0, maxGap: 8 } as const;
const policy = { layoutSeparationRules: [rule] };
const artwork = '<div class="artwork"></div>';
const caption = '<div class="caption">Poster</div>';
const fixture = (css: string, content = artwork + caption) => `<!doctype html><html lang="en">
  <style>
    html { background: white; font: 14px system-ui; }
    .card { position: relative; width: min(60vw, 300px); }
    .artwork { height: 120px; background: blue; }
    .caption { line-height: 20px; }
    ${css}
  </style><article class="card">${content}</article></html>`;

test('layout separation requires named endpoints and a valid gap range', () => {
  assert.deepEqual(validatePolicy().layoutSeparationRules, []);
  assert.deepEqual(validatePolicy(policy).layoutSeparationRules, [rule]);
  for (const invalid of [null, {}, { ...rule, before: '' }, { ...rule, axis: 'diagonal' },
    { ...rule, minGap: -1 }, { ...rule, minGap: '0' }, { ...rule, maxGap: -1 }, { ...rule, maxGap: NaN },
    { ...rule, minGap: 10 }, { ...rule, unknown: true }]) {
    assert.throws(() => validatePolicy({ layoutSeparationRules: [invalid] }), /layout separation/i);
  }
});

test('layout separation catches a hovered caption over the artwork and an excessive gap', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.mouse.move(width - 1, 899);
      await page.setContent(fixture('.card:hover .caption { position: absolute; bottom: 5px; }'));
      assert.ok(!(await checkPage(page, policy)).findings.some(item => item.rule === 'layout-separation'));
      await page.locator('.card').hover();
      const overlap = (await checkPage(page, policy)).findings.find(item => item.rule === 'layout-separation');
      assert.equal(overlap?.actual, '-25px');
      assert.ok(overlap?.relatedSelector);
      assert.ok(!(await checkPage(page)).findings.some(item => item.rule === 'layout-separation'));

      await page.setContent(fixture('.caption { margin-top: 8px; }'));
      assert.ok(!(await checkPage(page, policy)).findings.some(item => item.rule === 'layout-separation'));
      await page.setContent(fixture('.caption { margin-top: 24px; }'));
      assert.equal((await checkPage(page, policy)).findings.find(item => item.rule === 'layout-separation')?.actual, '24px');
    }
  } finally { await browser.close(); }
});

test('layout separation handles nested groups, right-to-left order, and missing measurements', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(fixture('', artwork + caption + `<article class="card">${artwork}${caption}</article>`));
    assert.ok(!(await checkPage(page, policy)).findings.some(item => item.rule === 'layout-separation'));

    await page.setContent(fixture('.card { display: flex; direction: rtl; gap: 6px; } .artwork { width: 40px; }'));
    const horizontal = { layoutSeparationRules: [{ ...rule, axis: 'horizontal' as const, minGap: 6, maxGap: 6 }] };
    assert.ok(!(await checkPage(page, horizontal)).findings.some(item => item.rule === 'layout-separation'));

    for (const [html, expected] of [
      [fixture('.caption { display: none; }'), '1 before and 0 after matches'],
      [fixture('', artwork + caption + caption), '1 before and 2 after matches'],
    ] as const) {
      await page.setContent(html);
      const finding = (await checkPage(page, policy)).findings.find(item => item.rule === 'layout-separation');
      assert.equal(finding?.actual, expected);
      assert.equal(finding?.status, 'unresolved');
    }
  } finally { await browser.close(); }
});
