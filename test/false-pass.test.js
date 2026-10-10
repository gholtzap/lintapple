import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
const { checkPage, checkUrl } = await import(process.env.LINTAPPLE_PACKAGE || '../src/index.js');
const execute = promisify(execFile);
const directory = resolve(process.env.LINTAPPLE_EVIDENCE_DIR || 'test-results/false-pass');
const shell = content => `<!doctype html><html lang="en"><title>Policy checks</title><style>
html{background:white;color:#202020;font:16px/24px system-ui}body{margin:24px}
button{font:16px system-ui;min-height:40px;padding:8px;background:white;color:#202020}
</style><body>${content}</body></html>`;
const cases = {
  contents: shell('<span style="display:contents;font:17px serif;color:#aaa">Project details</span>'),
  corrected: shell('<span style="display:contents">Project details</span>'),
  mixed: shell('<section>seamlessly<pre><code>seamlessly</code></pre></section>'),
  code: shell('<pre><code>seamlessly</code></pre>'),
  prose: shell('<section>seamlessly</section>'),
  split: shell('<p>Unlock <span>your</span> potential</p>'),
  blocks: shell('<section><p>Unlock</p><p>your potential</p></section>'),
  excluded: shell('<p>Unlock <code>your</code> potential</p>'),
  hidden: shell('<p hidden>seamlessly</p><p>Project details</p>'),
  button: shell('<button id="save" onclick="document.querySelector(\'#status\').textContent=\'Saved\'">Save</button><p id="status">Pending</p>'),
};

async function fixture(callback) {
  await mkdir(directory, { recursive: true });
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(cases[request.url.slice(1)] || cases.corrected);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const cli = async (route, args = []) => {
    try { return { code: 0, ...await execute(process.execPath, [process.env.LINTAPPLE_CLI || 'bin/lintapple.js', `${origin}/${route}`, '--json', ...args]) }; }
    catch (error) { if (typeof error.code !== 'number') throw error; return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
  };
  try { await callback(origin, cli); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('CLI checks visible boxless text and accepts its corrected state', async () => fixture(async (origin, cli) => {
  for (const route of ['contents', 'corrected']) {
    const output = await cli(route);
    assert.equal(output.code, route === 'contents' ? 1 : 0, output.stderr);
    const report = JSON.parse(output.stdout);
    for (const run of report.runs) assert.deepEqual([...new Set(run.states[0].findings.map(f => f.rule))].sort(), route === 'contents' ? ['font-family', 'font-size', 'text-contrast'] : []);
    await writeFile(join(directory, `${route}.json`), JSON.stringify(report, null, 2));
  }
}));

test('copy checks prose beside excluded code and keeps visible text boundaries', async () => fixture(async (origin, cli) => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const route of ['mixed', 'code', 'prose', 'split', 'blocks', 'excluded', 'hidden']) {
      const expected = ['mixed', 'prose', 'split', 'blocks'].includes(route) ? ['copy'] : [];
      const output = await cli(route);
      assert.equal(output.code, expected.length ? 1 : 0, `${route}: ${output.stderr}`);
      const report = JSON.parse(output.stdout);
      for (const run of report.runs) assert.deepEqual([...new Set(run.states[0].findings.map(f => f.rule))], expected, route);
      await page.goto(`${origin}/${route}`);
      assert.deepEqual([...new Set((await checkPage(page)).findings.map(f => f.rule))], expected, route);
      await writeFile(join(directory, `${route}.json`), JSON.stringify(report, null, 2));
    }
  } finally { await browser.close(); }
}));

test('CLI and URL API reject supplied invalid plans and execute valid plans', async () => fixture(async (origin, cli) => {
  const receipts = [];
  for (const [name, plan] of [['null', null], ['false', false], ['zero', 0], ['empty-string', ''], ['array', []]]) {
    const path = join(directory, `${name}-plan.json`);
    await writeFile(path, JSON.stringify(plan));
    const output = await cli('button', ['--interactions', path]);
    assert.equal(output.code, 2, name);
    assert.equal(output.stdout, '');
    assert.match(output.stderr, /Interaction plan must be an object/);
    await assert.rejects(checkUrl(`${origin}/button`, {}, { interactions: plan }), /Interaction plan must be an object/);
    receipts.push({ name, ...output });
  }
  for (const plan of [{}, { buttons: [{ selector: '#save', key: 'Enter', outcome: '#status', expectedText: 'Saved' }] }]) {
    const path = join(directory, 'valid-plan.json');
    await writeFile(path, JSON.stringify(plan));
    const output = await cli('button', ['--interactions', path]);
    assert.equal(output.code, 0, output.stderr);
    const report = JSON.parse(output.stdout);
    assert.deepEqual(report.findings, []);
    for (const run of report.runs) assert.deepEqual(run.states.map(state => state.name), plan.buttons ? ['initial', 'buttons[0]: Enter'] : ['initial']);
    receipts.push({ plan, code: output.code, report });
  }
  await writeFile(join(directory, 'interactions.json'), JSON.stringify(receipts, null, 2));
}));
