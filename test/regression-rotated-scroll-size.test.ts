import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkPage } from '../src/index.js';
import type { UrlReport } from '../src/types.js';
import { assertProcessError } from './assert-process-error.js';

const execute = promisify(execFile);
const policy = { minControlSize: 44, iconSizeRules: [{ selector: 'button', sizes: [80] }] };
const fixture = (axis: string, angle: number, individual = false, mode = 'scroll') => `<!doctype html><html lang="en"><title>Rotated scroll control</title><style>
html{background:white;color:#111;font:16px system-ui}body{margin:80px}
#scroll{position:relative;width:120px;height:160px;border-style:solid;border-color:#111;border-width:4px 2px 6px 10px;overflow:${mode === 'clip' ? 'clip' : 'auto'};${individual ? `rotate:${angle}deg;translate:7px 11px` : `transform:translate(7px,11px) rotate(${angle}deg)`}}
button{position:absolute;left:${axis === 'X' ? mode === 'unreachable' ? -60 : 100 : 0}px;top:${axis === 'Y' ? mode === 'unreachable' ? -60 : 140 : 0}px;box-sizing:border-box;width:80px;height:80px;border:0;padding:0;font:inherit;color:#111;background:#ddd}
</style><body><div id="scroll"><button onclick="this.textContent='Saved'">Save</button></div></body></html>`;

test('button and icon sizes follow rotated scrolling axes and asymmetric borders', async () => {
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark'] as const)
      for (const axis of ['X', 'Y']) for (const angle of [0, 90, -90, 180, 270]) for (const individual of [false, true]) for (const mode of ['scroll', 'clip', 'unreachable']) {
        const page = await browser.newPage({ viewport: { width, height: 720 }, colorScheme });
        try {
          await page.setContent(fixture(axis, angle, individual, mode));
          const positions = await page.locator('#scroll').evaluate(el => [el.scrollLeft, el.scrollTop]);
          const initial = await checkPage(page, policy);
          assert.deepEqual(await page.locator('#scroll').evaluate(el => [el.scrollLeft, el.scrollTop]), positions);
          const fails = mode !== 'scroll';
          for (const rule of ['control-size', 'icon-size'])
            assert.equal(initial.findings.some(f => f.rule === rule), fails, `${axis}/${angle}/${individual}/${mode}/${width}/${colorScheme}: ${JSON.stringify(initial.findings)}`);
          if (!fails) {
            await page.getByRole('button', { name: 'Save', exact: true }).scrollIntoViewIfNeeded();
            assert.equal(await page.locator('button').evaluate(el => {
              const rect = el.getBoundingClientRect();
              return [[rect.left + 1, rect.top + 1], [rect.right - 1, rect.top + 1], [rect.left + 1, rect.bottom - 1], [rect.right - 1, rect.bottom - 1]].every(([x, y]) => document.elementFromPoint(x, y) === el);
            }), true, 'The browser must expose the full button.');
            const scrolled = await checkPage(page, policy);
            assert.ok(!scrolled.findings.some(f => ['control-size', 'icon-size'].includes(f.rule)), JSON.stringify(scrolled.findings));
            await page.getByRole('button', { name: 'Save', exact: true }).click();
            assert.equal(await page.getByRole('button').textContent(), 'Saved');
          }
        } finally { await page.close(); }
      }
  } finally { await browser.close(); }
});

test('CLI checks control and icon sizes through rotated scrollports', async () => {
  const directory = resolve('test-results/rotated-scroll-size');
  await mkdir(directory, { recursive: true });
  const config = resolve(directory, 'policy.json');
  await writeFile(config, JSON.stringify({ ...policy, viewports: [{ width: 390, height: 720 }, { width: 1440, height: 720 }], colorSchemes: ['light', 'dark'] }));
  for (const individual of [false, true]) for (const mode of ['scroll', 'clip', 'unreachable']) {
    const file = resolve(directory, `${individual}-${mode}.html`);
    await writeFile(file, fixture('X', 90, individual, mode));
    let code = 0, stdout: string;
    try { ({ stdout } = await execute(process.execPath, ['dist/bin/lintapple.js', pathToFileURL(file).href, '--config', config, '--json'])); }
    catch (error) { assertProcessError(error); assert.equal(typeof error.code, 'number'); code = Number(error.code); stdout = error.stdout; }
    const report: UrlReport = JSON.parse(stdout);
    await writeFile(`${file}.json`, stdout);
    assert.equal(code, mode === 'scroll' ? 0 : 1, `${individual}/${mode}: ${stdout}`);
    for (const run of report.runs) for (const rule of ['control-size', 'icon-size'])
      assert.equal(run.states[0].findings.some(f => f.rule === rule), mode !== 'scroll', `${individual}/${mode}`);
  }
});
