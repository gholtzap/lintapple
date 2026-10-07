import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { checkPage, checkUrl } from '../src/index.js';

const fixture = (containerStyle = '', buttonStyle = '', content) => `<!doctype html><html><style>
html { background: white; font: 16px system-ui; }
body { margin: 24px; }
.box { position: relative; box-sizing: border-box; width: 160px; padding: 8px; border: 20px solid #ddd; ${containerStyle} }
button { box-sizing: border-box; display: block; width: 24px; height: 24px; padding: 0; border: 0; font: inherit; ${buttonStyle} }
</style><body><div class="box" data-ui-container>${content ?? '<button aria-label="More">+</button>'}</div></body></html>`;

test('control inset checks rendered edges, borders, wrappers, selectors, and exceptions', async () => {
  const browser = await chromium.launch();
  const receipt = [];
  try {
    const page = await browser.newPage();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const cases = [
        { name: '8 px padding', html: fixture(), edges: [] },
        { name: 'border cannot replace padding', html: fixture('padding: 0;'), edges: ['left', 'top', 'bottom'] },
        { name: '7 px padding fails', html: fixture('padding: 7px;'), edges: ['left', 'top', 'bottom'] },
        { name: 'absolute left', html: fixture('height: 100px;', 'position: absolute; left: 0; top: 8px;'), edges: ['left'] },
        { name: 'absolute right', html: fixture('height: 100px;', 'position: absolute; right: 0; top: 8px;'), edges: ['right'] },
        { name: 'absolute top', html: fixture('height: 100px;', 'position: absolute; left: 8px; top: 0;'), edges: ['top'] },
        { name: 'absolute bottom', html: fixture('height: 100px;', 'position: absolute; left: 8px; bottom: 0;'), edges: ['bottom'] },
        { name: 'negative margin in wrapper', html: fixture('', 'margin-left: -4px;', '<div><button aria-label="More">+</button></div>'), edges: ['left'] },
        { name: 'translated button', html: fixture('', 'transform:translateX(-4px);'), edges: ['left'] },
        { name: 'scaled container', html: fixture('transform:scale(0.5);transform-origin:top left;'), edges: ['left', 'top', 'bottom'] },
        { name: 'button outside border', html: fixture('height: 100px;', 'position: absolute; left: -4px; top: 8px;'), edges: ['left'] },
        { name: 'hidden button', html: fixture('padding: 0;', 'display: none;'), edges: [] },
        { name: 'nested padded container', html: fixture('padding: 0;', '', '<div data-ui-container style="padding:8px"><div><button aria-label="More">+</button></div></div>'), edges: [] },
      ];
      for (const entry of cases) {
        await page.setContent(entry.html);
        const result = await checkPage(page);
        const findings = result.findings.filter(f => f.rule === 'control-inset');
        assert.deepEqual(findings.map(f => f.actual.split(' ')[0]).sort(), [...entry.edges].sort(), `${entry.name}: ${JSON.stringify(findings)}`);
        assert.ok(findings.every(f => f.relatedSelector && f.selector.includes('button') && f.fix));
        receipt.push({ viewport: width, case: entry.name, expectedEdges: entry.edges, findings });
      }
    }
    await page.setContent(fixture('padding:0;').replace(' data-ui-container', ''));
    assert.equal((await checkPage(page)).findings.filter(f => f.rule === 'control-inset').length, 0);
    const configured = await checkPage(page, { controlContainers: ['.box'], minControlInset: 12 });
    assert.equal(configured.findings.filter(f => f.rule === 'control-inset').length, 3);
    assert.ok(configured.findings.filter(f => f.rule === 'control-inset').every(f => f.expected.includes('12px')));
    const excepted = await checkPage(page, { controlContainers: ['.box'], exceptions: [{ selector: 'button', rules: ['control-inset'], reason: 'This control is attached to the container edge.' }] });
    assert.equal(excepted.findings.filter(f => f.rule === 'control-inset').length, 0);
    assert.equal(excepted.suppressed.length, 3);
    await assert.rejects(checkPage(page, { minControlInset: -1 }), /minControlInset/);
    await assert.rejects(checkPage(page, { controlContainers: ['['] }));
    await assert.rejects(checkPage(page, { controlContainers: 'div' }), /controlContainers/);
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/control-inset.html', fixture('padding:0;'));
    const url = new URL('../test-results/control-inset.html', import.meta.url).href;
    const report = await checkUrl(url);
    assert.ok(report.rules.includes('control-inset'));
    assert.equal(report.findings.filter(f => f.rule === 'control-inset').length, 6);
    assert.ok(report.runs.every(run => run.insetControls === 1));
    await writeFile('test-results/control-inset-report.json', JSON.stringify(report, null, 2));
    await writeFile('test-results/control-inset-receipt.json', JSON.stringify({ command: 'npm test', inputs: 'test/control-inset.test.js', node: process.version, cases: receipt }, null, 2));
  } finally { await browser.close(); }
});
