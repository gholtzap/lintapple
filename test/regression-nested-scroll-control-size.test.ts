import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { checkPage } from '../src/index.js';
import type { UrlReport } from '../src/types.js';
import { assertProcessError } from './assert-process-error.js';

const execute = promisify(execFile);
const cases = ['X', 'Y'].flatMap(axis => [-60, 0, 100].flatMap(offset => [0, 100].flatMap(outerOffset => [20, 120].map(size => ({ axis, offset, outerOffset, size })))));
type Case = typeof cases[number];
const fixture = ({ axis, offset, outerOffset, size }: Case) => `<!doctype html><html lang="en"><title>Nested scroll controls</title><style>
html{background:white;color:#111;font:16px system-ui}body{margin:24px}
#outer{width:120px;height:120px;overflow:auto}
#inner{position:relative;width:${axis === 'X' ? size : 120}px;height:${axis === 'Y' ? size : 120}px;overflow:auto;margin-${axis === 'X' ? 'left' : 'top'}:${outerOffset}px}
button{position:absolute;left:${axis === 'X' ? offset : 0}px;top:${axis === 'Y' ? offset : 0}px;width:80px;height:80px;border:0;padding:0;font:inherit;background:#ddd;color:#111}
</style><body><div id="outer"><div id="inner"><button onclick="document.querySelector('#result').textContent='Saved'">Save</button></div></div><p id="result">Pending</p></body></html>`;

test('nested scroll controls keep the same size before and after real scrolling and clicks', async () => {
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark'] as const) for (const entry of cases) {
      const page = await browser.newPage({ viewport: { width, height: 720 }, colorScheme });
      try {
        await page.setContent(fixture(entry));
        const position = () => page.locator('#outer, #inner').evaluateAll(elements => elements.map(el => [el.scrollLeft, el.scrollTop]));
        const before = await position();
        const initial = await checkPage(page, { minControlSize: 44 });
        assert.deepEqual(await position(), before, 'The audit must not scroll the app.');
        const reachable = await page.evaluate(() => {
          const outer = document.querySelector('#outer')!, inner = document.querySelector('#inner')!, button = document.querySelector('button')!;
          let reachable = false;
          for (const a of [-10000, 0, 10000]) for (const b of [-10000, 0, 10000]) {
            outer.scrollLeft = outer.scrollTop = a;
            inner.scrollLeft = inner.scrollTop = b;
            const rects = [outer, inner, button].map(el => el.getBoundingClientRect());
            const left = Math.max(...rects.map(rect => rect.left)), right = Math.min(...rects.map(rect => rect.right));
            const top = Math.max(...rects.map(rect => rect.top)), bottom = Math.min(...rects.map(rect => rect.bottom));
            reachable ||= right - left >= 44 && bottom - top >= 44 && document.elementFromPoint((left + right) / 2, (top + bottom) / 2) === button;
          }
          return reachable;
        });
        assert.equal(reachable, entry.offset >= 0 && entry.size >= 44, `Browser reachability: ${JSON.stringify(entry)}`);
        const scrolledPosition = await position();
        const scrolled = await checkPage(page, { minControlSize: 44 });
        assert.deepEqual(await position(), scrolledPosition);
        for (const report of [initial, scrolled])
          assert.equal(report.findings.some(f => f.rule === 'control-size'), !reachable, `${JSON.stringify(entry)}/${width}/${colorScheme}: ${JSON.stringify(report.findings)}`);
        if (reachable) {
          await page.getByRole('button', { name: 'Save', exact: true }).click();
          assert.equal(await page.locator('#result').textContent(), 'Saved');
        }
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});

test('CLI accepts reachable nested controls and rejects unreachable or narrow scrollports', async () => {
  const directory = resolve('test-results/nested-scroll-controls');
  await mkdir(directory, { recursive: true });
  const config = resolve(directory, 'policy.json');
  await writeFile(config, JSON.stringify({ minControlSize: 44, viewports: [{ width: 390, height: 720 }, { width: 1440, height: 720 }], colorSchemes: ['light', 'dark'] }));
  for (const entry of cases.filter(entry => entry.outerOffset === 100 && (entry.offset === 100 || entry.offset === -60 && entry.size === 120))) {
    const file = resolve(directory, `${entry.axis}-${entry.offset}-${entry.size}.html`);
    await writeFile(file, fixture(entry));
    let code = 0, stdout: string;
    try { ({ stdout } = await execute(process.execPath, ['dist/bin/lintapple.js', pathToFileURL(file).href, '--config', config, '--json'])); }
    catch (error) { assertProcessError(error); assert.equal(typeof error.code, 'number'); code = Number(error.code); stdout = error.stdout; }
    const report: UrlReport = JSON.parse(stdout);
    await writeFile(`${file}.json`, stdout);
    const fails = entry.offset < 0 || entry.size < 44;
    assert.equal(code, fails ? 1 : 0, JSON.stringify(entry));
    assert.equal(report.runs.length, 4);
    for (const run of report.runs) assert.equal(run.states[0].findings.some(f => f.rule === 'control-size'), fails, JSON.stringify(entry));
  }
});
