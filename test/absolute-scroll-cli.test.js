import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const execute = promisify(execFile);
const pageHtml = (position, overflow = 'auto', containerPosition = 'static') => `<!doctype html><html lang="en"><style>
html{background:#fff;color:#111;font:16px system-ui}body{margin:24px}
</style><body><p>Project ready</p><div id="scroll" style="position:${containerPosition};overflow:${overflow};width:200px;height:80px"><div id="target" style="position:absolute;left:${position}px;top:100px;width:160px;height:40px">Lost text</div></div></body></html>`;

test('CLI rejects absolute content that a static overflow ancestor cannot scroll into view', async () => {
  const cases = {
    offscreen: { html: pageHtml(-180), rules: ['viewport-bounds'] },
    'without-scroll': { html: pageHtml(-180, 'visible'), rules: ['viewport-bounds'] },
    onscreen: { html: pageHtml(24), rules: [] },
    scrollable: { html: pageHtml(240, 'auto', 'relative'), rules: [] },
  };
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(cases[request.url.slice(1)].html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    await mkdir('test-results', { recursive: true });
    const policy = 'test-results/absolute-scroll-policy.json';
    await writeFile(policy, JSON.stringify({ colorSchemes: ['light', 'dark'] }));
    for (const [name, entry] of Object.entries(cases)) {
      const url = `http://127.0.0.1:${server.address().port}/${name}`;
      let output;
      try { output = { code: 0, ...await execute(process.execPath, [process.env.LINTAPPLE_CLI || 'bin/lintapple.js', url, '--config', policy, '--json']) }; }
      catch (error) { if (typeof error.code !== 'number') throw error; output = { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
      const report = JSON.parse(output.stdout);
      await writeFile(`test-results/absolute-scroll-${name}.json`, JSON.stringify(report, null, 2));
      assert.equal(output.code, entry.rules.length ? 1 : 0, `${name}: ${output.stderr}`);
      assert.equal(report.runs.length, 4);
      for (const run of report.runs) {
        assert.deepEqual([...new Set(run.states[0].findings.map(f => f.rule))], entry.rules, name);
        const page = await browser.newPage({ viewport: run.viewport, colorScheme: run.colorScheme });
        try {
          await page.goto(url);
          const bounds = await page.evaluate(() => {
            const scroll = document.querySelector('#scroll'), target = document.querySelector('#target');
            scroll.scrollLeft = -10000;
            const left = scroll.scrollLeft;
            scroll.scrollLeft = 10000;
            return { right: target.getBoundingClientRect().right, left, max: scroll.scrollLeft, width: scroll.clientWidth, scrollWidth: scroll.scrollWidth };
          });
          if (name === 'offscreen') {
            assert.ok(bounds.right < 0, 'The text must be fully outside the viewport.');
            assert.equal(bounds.left, 0);
            assert.equal(bounds.max, 0, 'The ancestor cannot scroll to the text.');
            assert.equal(bounds.scrollWidth, bounds.width);
          }
          if (name === 'scrollable') assert.ok(bounds.max > 0, 'The positioned ancestor must provide real scrolling.');
        } finally { await page.close(); }
      }
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
