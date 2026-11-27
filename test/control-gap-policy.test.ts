import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { checkPage, validatePolicy } from '../src/index.js';
import { html } from './audit-cases.js';

test('control gap rules preserve the default in other and nested groups', async () => {
  const browser = await chromium.launch({ channel: process.env.LINTAPPLE_BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage();
    await page.setContent(html(`
      .row { display:flex; gap:4px; }
      .segment { gap:2px; }
    `, `
      <div class="row segment">
        <span><button id="grid">Grid</button></span><span><button id="list">List</button></span>
        <div class="row" data-ui-actions><button id="next">Next</button><button id="back">Back</button></div>
      </div>
      <div class="row"><button id="save">Save</button><button id="cancel">Cancel</button></div>
    `));
    const controlGapRules = [{ selector: '.segment', minGap: 2 }, { selector: '.row.segment', minGap: 10 }];
    const gaps = async () => {
      const { findings } = await checkPage(page, { controlGapRules });
      return page.evaluate(items => items.map(f =>
        [document.querySelector(f.selector)?.id, document.querySelector(f.relatedSelector!)?.id, f.actual]).sort(),
      findings.filter(f => f.rule === 'control-gap'));
    };
    assert.deepEqual(await gaps(), [['next', 'back', '4px'], ['save', 'cancel', '4px']]);
    await page.locator('.segment').evaluate(el => el.style.gap = '1px');
    assert.deepEqual(await gaps(), [['grid', 'list', '1px'], ['next', 'back', '4px'], ['save', 'cancel', '4px']]);
  } finally { await browser.close(); }
});

test('control gap policy accepts zero and rejects invalid entries', () => {
  assert.equal(validatePolicy({ controlGapRules: [{ selector: '.joined', minGap: 0 }] }).controlGapRules[0].minGap, 0);
  for (const rule of [{ selector: '', minGap: 1 }, { selector: '.joined', minGap: -1 },
    { selector: '.joined', minGap: NaN }, { selector: '.joined', minGap: '2' }, null])
    assert.throws(() => validatePolicy({ controlGapRules: [rule] }), /control gap rule/);
});

test('alignment rules select items without including nested groups', async () => {
  const browser = await chromium.launch({ channel: process.env.LINTAPPLE_BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage();
    await page.setContent(html(`
      .group .group { margin-left:32px; }
      .group .group > div { margin-left:12px; }
    `, `
      <section class="group">
        <div class="item">Outer title</div><div id="details" class="item">Outer details</div>
        <section class="group"><div class="item">Inner title</div><div class="item">Inner details</div></section>
      </section>
    `));
    const policy = { alignmentRules: [{ selector: '.group', itemSelector: '.item', alignment: 'start' as const }] };
    const baseline = await checkPage(page, policy);
    assert.equal(baseline.alignmentGroups, 2);
    assert.ok(!baseline.findings.some(f => f.rule === 'layout-alignment'));
    await page.locator('#details').evaluate(el => el.style.marginLeft = '6px');
    const { findings } = await checkPage(page, policy);
    assert.deepEqual(findings.filter(f => f.rule === 'layout-alignment').map(f => f.actual), ['6px horizontal misalignment']);
    assert.throws(() => validatePolicy({ alignmentRules: [{ selector: '.group', itemSelector: '.item', alignment: 'left' }] }), /alignment rule/);
  } finally { await browser.close(); }
});
