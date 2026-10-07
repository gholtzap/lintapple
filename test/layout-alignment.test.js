import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { checkPage, checkUrl } from '../src/index.js';

const fixture = (alignment = 'start', heading = '', actions = '', attributes = '') => `<!doctype html><html><style>
html { background: white; color: #202020; font: 16px/24px system-ui; }
body { margin: 24px; } p { margin: 0; }
.panel { width: 224px; padding: 16px; border: 1px solid #ddd; }
.heading { ${heading} }
.actions { display: flex; gap: 8px; padding: 8px; ${actions} }
button { font: 14px system-ui; padding: 8px; min-height: 40px; }
</style><body><section class="panel" data-ui-align="${alignment}" ${attributes}>
<p class="heading" data-ui-align-item>Edit project</p>
<div class="actions" data-ui-actions data-ui-container><button data-ui-align-item>Cancel</button><button>Save</button></div>
</section></body></html>`;
const alignmentFindings = report => report.findings.filter(finding => finding.rule === 'layout-alignment');

test('alignment checks marked rendered items through wrappers and preserves valid layouts', async () => {
  const browser = await chromium.launch();
  const cases = [];
  try {
    const page = await browser.newPage();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const entry of [
        { name: 'nested action padding', html: fixture(), count: 1, actual: '8px horizontal misalignment' },
        { name: 'matching inset', html: fixture('start', 'margin-inline: 8px;'), count: 0 },
        { name: 'shifted control', html: fixture('start', 'margin-inline: 8px;', 'transform:translateX(3px);'), count: 1, actual: '3px horizontal misalignment' },
        { name: 'subpixel tolerance', html: fixture('start', 'margin-inline: 7px;'), count: 0 },
        { name: 'outside tolerance', html: fixture('start', 'margin-inline: 6.5px;'), count: 1, actual: '1.5px horizontal misalignment' },
        { name: 'unmarked layout', html: fixture().replace('data-ui-align="start"', ''), count: 0 },
        { name: 'RTL start', html: fixture('start', 'margin-inline: 8px;', '', 'dir="rtl"'), count: 0 },
        { name: 'RTL offset', html: fixture('start', '', '', 'dir="rtl"'), count: 1, actual: '8px horizontal misalignment' },
        { name: 'center', html: fixture('center', 'width:60px;margin-inline:auto;', 'flex-direction:column;align-items:center;'), count: 0 },
        { name: 'end', html: fixture('end', 'margin-inline:8px;', 'flex-direction:column;align-items:flex-end;'), count: 0 },
        { name: 'RTL end', html: fixture('end', 'margin-inline:8px;', 'flex-direction:column;align-items:flex-end;', 'dir="rtl"'), count: 0 },
        { name: 'hidden item', html: fixture().replace('<button data-ui-align-item>', '<button data-ui-align-item hidden>'), count: 0 },
        { name: 'nested group', html: fixture('start', 'margin-inline:8px;').replace('</section>', '<div data-ui-align="center"><p data-ui-align-item>Other heading</p><p data-ui-align-item>Other label</p></div></section>'), count: 0 },
        { name: 'invalid value', html: fixture('top'), count: 1 },
        { name: 'missing markers', html: fixture().replaceAll(' data-ui-align-item', ''), count: 1 },
      ]) {
        await page.setContent(entry.html);
        const result = await checkPage(page);
        const findings = alignmentFindings(result);
        assert.equal(findings.length, entry.count, `${width}px ${entry.name}: ${JSON.stringify(findings)}`);
        if (entry.actual) assert.equal(findings[0].actual, entry.actual);
        if (entry.actual) assert.ok(findings[0].relatedSelector && findings[0].selector.includes('button'));
        if (entry.name === 'matching inset') assert.deepEqual(result.findings, []);
        if (entry.name === 'nested group') assert.equal(result.alignmentGroups, 2);
        cases.push({ width, name: entry.name, findings });
      }
    }
    await page.setContent(fixture());
    const excepted = await checkPage(page, { exceptions: [{ selector: 'button[data-ui-align-item]', rules: ['layout-alignment'], reason: 'Test the shared exception contract.' }] });
    assert.deepEqual(alignmentFindings(excepted), []);
    assert.equal(excepted.suppressed.filter(item => item.rule === 'layout-alignment').length, 1);
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/layout-alignment.html', fixture());
    const report = await checkUrl(new URL('../test-results/layout-alignment.html', import.meta.url).href);
    assert.ok(report.rules.includes('layout-alignment'));
    assert.equal(alignmentFindings(report).length, 2);
    assert.ok(report.runs.every(run => run.alignmentGroups === 1));
    assert.deepEqual(await checkUrl(report.url), report);
    await writeFile('test-results/layout-alignment-receipt.json', JSON.stringify({ command: 'npm test', cases, report }, null, 2));
  } finally { await browser.close(); }
});
