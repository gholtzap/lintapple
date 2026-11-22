import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { checkPage, summarizeFindings } from '../src/index.js';
import { expectUI } from '../src/playwright.js';
import { html } from './audit-cases.js';

test('a scoped audit keeps page context and groups findings by unique keys', async () => {
  const browser = await chromium.launch({ channel: process.env.LINTAPPLE_BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage();
    await page.setContent(html(`
      button { font:16px system-ui; height:32px; padding:0 12px; }
      .tiny { width:10px; min-width:0; padding:0; }
      .clipping { width:24px; overflow:hidden; white-space:nowrap; }
    `, `
      <main>
        <button class="tiny" id="outside" aria-label="Outside"></button>
        <div class="clipping"><span id="trigger">Open workspace search</span></div>
      </main>
      <section id="portal">
        <button class="tiny" data-testid="small" aria-label="Small"></button>
        <button class="tiny" id="same" data-testid="duplicate" aria-label="Duplicate"></button>
        <span id="same" data-testid="duplicate">Duplicate</span>
      </section>
      <section hidden id="hidden">Hidden</section>
    `));
    const options = { scope: ['#trigger', '#portal'], identityAttribute: 'data-testid' } as const;
    const scoped = await checkPage(page, {}, options);
    assert.deepEqual(scoped.scope, options.scope);
    assert.ok(scoped.findings.some(f => f.rule === 'content-clipping' && f.elementKey === '[id=trigger]' && f.relatedSelector));
    const sizes = (report: typeof scoped) => report.findings.filter(f => f.rule === 'control-size');
    assert.equal(sizes(await checkPage(page)).length, 3);
    assert.equal(sizes(scoped).length, 2);
    assert.equal(sizes(scoped)[1].elementKey, undefined, 'duplicate identifiers fall back to position');

    await page.locator('#portal').evaluate(el => el.insertAdjacentHTML('afterbegin', '<button style="margin-inline-end:12px">New</button>'));
    const after = await checkPage(page, {}, options);
    const beforeFinding = sizes(scoped).find(f => f.elementKey === '[data-testid=small]')!;
    const afterFinding = sizes(after).find(f => f.elementKey === '[data-testid=small]')!;
    assert.notEqual(afterFinding.selector, beforeFinding.selector);
    assert.equal(summarizeFindings([beforeFinding, afterFinding]).problems, 1);
    assert.equal(summarizeFindings([beforeFinding, sizes(after)[1]]).problems, 2);
    for (const scope of [[], ['#missing'], ['#hidden'], ['#same']])
      await assert.rejects(checkPage(page, {}, { scope }), /scope/i);

    const attachments: string[] = [];
    await expectUI(page, { attach: async name => { attachments.push(name); } }, {}, { scope: ['#portal button:first-child'] });
    assert.deepEqual(attachments, ['lintapple coverage']);
  } finally { await browser.close(); }
});
