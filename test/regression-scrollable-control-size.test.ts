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
const cases = [
  { name: 'vertical fold', axis: 'Y', offset: 100, fails: false },
  { name: 'normal flow fold', axis: 'Y', offset: 100, flow: true, fails: false },
  { name: 'horizontal fold', axis: 'X', offset: 100, fails: false },
  { name: 'unreachable top', axis: 'Y', offset: -60, fails: true },
  { name: 'unreachable left', axis: 'X', offset: -60, fails: true },
  { name: 'unreachable top with positive overflow', axis: 'Y', offset: -60, extent: true, fails: true },
  { name: 'permanent clip', axis: 'Y', offset: 100, overflow: 'clip', fails: true },
  { name: 'small button', axis: 'Y', offset: 100, size: 20, fails: true },
  { name: 'rtl reachable left', axis: 'X', offset: -60, css: 'direction:rtl;', fails: false },
  { name: 'rtl unreachable right', axis: 'X', offset: 100, css: 'direction:rtl;', fails: true },
  { name: 'reverse flex reachable top', axis: 'Y', offset: -60, css: 'display:flex;flex-direction:column-reverse;', fails: false },
  { name: 'reverse flex unreachable bottom', axis: 'Y', offset: 100, css: 'display:flex;flex-direction:column-reverse;', fails: true },
  { name: 'vertical writing reachable left', axis: 'X', offset: -60, css: 'writing-mode:vertical-rl;', fails: false },
  { name: 'scrollport too small', axis: 'Y', offset: 0, css: 'height:20px;', fails: true },
  { name: 'scrollport clipped by shell', axis: 'Y', offset: 100, css: 'height:240px;', fails: true },
  { name: 'bordered scrollport', axis: 'Y', offset: 100, css: 'border:2px solid black;box-sizing:border-box;', fails: false },
  { name: 'flipped vertical scrollport', axis: 'Y', offset: 100, css: 'transform:scaleY(-1);', fails: false },
  { name: 'flipped horizontal scrollport', axis: 'X', offset: 100, css: 'scale:-1 1;', fails: false },
  { name: 'aligned reverse flex', axis: 'Y', offset: -60, css: 'display:flex;flex-direction:column-reverse;justify-content:flex-end;', fails: false },
] as const;
type Case = { name: string; axis: string; offset: number; fails: boolean; css?: string; overflow?: string; size?: number; extent?: boolean; flow?: boolean };
const fixture = (entry: Case) => `<!doctype html><html lang="en"><title>Scrollable control</title><style>
html{background:#fff;color:#111;font:16px system-ui}body{margin:24px}
#shell,#scroll{width:120px;height:120px}#shell{overflow:hidden}
#scroll{overflow:${entry.overflow ?? 'auto'};position:relative;${entry.css ?? ''}}
button{position:${entry.flow ? 'static' : 'absolute'};left:${entry.axis === 'X' ? entry.offset : 0}px;top:${entry.axis === 'Y' ? entry.offset : 0}px;box-sizing:border-box;width:${entry.size ?? 80}px;height:${entry.size ?? 80}px;padding:0;border:0;font:inherit;color:inherit;background:white}
</style><body><div id="shell"><div id="scroll">${entry.flow ? `<div style="height:${entry.offset}px"></div>` : ''}<button id="save">Save</button>${entry.extent ? '<div style="position:absolute;top:240px;width:1px;height:1px"></div>' : ''}</div></div></body></html>`;

test('control size distinguishes scrollable controls from unreachable and permanent clips', async () => {
  const browser = await chromium.launch();
  const receipts: unknown[] = [];
  await mkdir('test-results/scrollable-control-size', { recursive: true });
  try {
    for (const width of [390, 1280]) for (const colorScheme of ['light', 'dark'] as const) for (const entry of cases) {
      const page = await browser.newPage({ viewport: { width, height: 720 }, colorScheme });
      try {
        await page.setContent(fixture(entry));
        const beforeInitial = await page.locator('#scroll').evaluate(el => [el.scrollLeft, el.scrollTop]);
        const initial = await checkPage(page, { minControlSize: 44 });
        assert.deepEqual(await page.locator('#scroll').evaluate(el => [el.scrollLeft, el.scrollTop]), beforeInitial);
        const geometry = await page.locator('#scroll').evaluate((node, axis) => {
          const el = node as HTMLElement;
          const button = el.querySelector('button')!;
          const bounds = () => {
            const target = button.getBoundingClientRect(), port = el.getBoundingClientRect(), shell = el.parentElement!.getBoundingClientRect();
            return { scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, button: { left: target.left, top: target.top, right: target.right, bottom: target.bottom, width: target.width, height: target.height },
              hitWidth: Math.max(0, Math.min(target.right, port.right, shell.right) - Math.max(target.left, port.left, shell.left)),
              hitHeight: Math.max(0, Math.min(target.bottom, port.bottom, shell.bottom) - Math.max(target.top, port.top, shell.top)) };
          };
          const before = bounds();
          if (axis === 'X') el.scrollLeft = -10000; else el.scrollTop = -10000;
          const minimum = bounds();
          if (axis === 'X') el.scrollLeft = 10000; else el.scrollTop = 10000;
          const maximum = bounds();
          return { before, minimum, maximum, scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight };
        }, entry.axis);
        const beforeAudit = await page.locator('#scroll').evaluate(el => [el.scrollLeft, el.scrollTop]);
        const scrolled = await checkPage(page, { minControlSize: 44 });
        assert.deepEqual(await page.locator('#scroll').evaluate(el => [el.scrollLeft, el.scrollTop]), beforeAudit, 'The audit must preserve scroll positions.');
        receipts.push({ name: entry.name, width, colorScheme, geometry, initial, scrolled });
        const reachable = [geometry.before, geometry.minimum, geometry.maximum].some(sample => sample.hitWidth >= 44 && sample.hitHeight >= 44);
        assert.equal(reachable, !entry.fails, `Browser reachability: ${entry.name}`);
        for (const [state, report] of [['initial', initial], ['scrolled', scrolled]] as const)
          assert.equal(report.findings.some(f => f.rule === 'control-size'), entry.fails, `${entry.name}/${width}/${colorScheme}/${state}: ${JSON.stringify(report.findings)}`);
      } finally { await page.close(); }
    }
  } finally {
    await writeFile('test-results/scrollable-control-size/browser.json', JSON.stringify(receipts, null, 2));
    await browser.close();
  }
});

test('CLI reports permanent clips but accepts controls reachable through scrolling', async () => {
  const directory = resolve('test-results/scrollable-control-size');
  await mkdir(directory, { recursive: true });
  const config = resolve(directory, 'policy.json');
  await writeFile(config, JSON.stringify({ minControlSize: 44, viewports: [{ width: 390, height: 720 }, { width: 1280, height: 720 }], colorSchemes: ['light', 'dark'] }));
  for (const entry of cases.filter(entry => ['vertical fold', 'normal flow fold', 'unreachable top', 'unreachable top with positive overflow', 'permanent clip'].includes(entry.name))) {
    const file = resolve(directory, `${entry.name.replaceAll(' ', '-')}.html`);
    await writeFile(file, fixture(entry));
    let stdout: string;
    let code = 0;
    try { ({ stdout } = await execute(process.execPath, ['dist/bin/lintapple.js', pathToFileURL(file).href, '--config', config, '--json'])); }
    catch (error) { assertProcessError(error); assert.equal(typeof error.code, 'number'); code = Number(error.code); stdout = error.stdout; }
    const report: UrlReport = JSON.parse(stdout);
    await writeFile(`${file}.json`, stdout);
    assert.equal(code, entry.fails ? 1 : 0, entry.name);
    assert.equal(report.runs.length, 4);
    for (const run of report.runs) assert.equal(run.states[0]!.findings.some(f => f.rule === 'control-size'), entry.fails, entry.name);
  }
});
