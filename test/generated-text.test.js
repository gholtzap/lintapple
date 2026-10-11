import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const { checkPage } = await import(process.env.LINTAPPLE_PACKAGE || '../src/index.js');
const run = promisify(execFile);
const policy = { typeRules: [{ selector: '.field-label', sizes: [16] }], colorSchemes: ['light', 'dark'] };
const fixture = (css, body = '<p class="field-label">Name</p><p class="field-label generated" data-label="Email"></p>') => `<html lang="en"><style>html{background:#fff;color:#111;font:16px system-ui}body{margin:24px}.field-label{font-size:16px;margin:8px 0}${css}</style><body>${body}</body></html>`;

test('generated label sizes obey the text role without checking hidden or empty content', async () => {
  const browser = await chromium.launch();
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) for (const colorScheme of policy.colorSchemes) {
      const page = await browser.newPage({ viewport, colorScheme });
      for (const [css, pseudo] of [
        ['.generated::before{content:attr(data-label);font-size:20px}', '::before'],
        ['.generated::after{content:"Email";font-size:20px}', '::after'],
        ['.generated{display:contents}.generated::before{content:"Email";font-size:20px}', '::before'],
        ['.generated::before{content:"\\45 mail";font-size:20px}', '::before'],
      ]) {
        await page.setContent(fixture(css));
        const findings = (await checkPage(page, policy)).findings;
        assert.equal(findings.length, 1, `${viewport.width}, ${colorScheme}, ${css}`);
        assert.equal(findings[0].rule, 'font-size');
        assert.equal(findings[0].actual, '20px');
        assert.equal(findings[0].expected, 'one of 16px');
        assert.ok(findings[0].selector.endsWith(pseudo));
      }
      for (const css of [
        '.generated::before{content:"Email";font-size:16px}',
        '.generated::before{content:"";font-size:20px}',
        '.generated::before{content:" ";font-size:20px}',
        '.generated::before{content:none;font-size:20px}',
        '.generated::before{content:"Email";font-size:20px;display:none}',
        '.generated::before{content:"Email";font-size:20px;visibility:hidden}',
        '.generated::before{content:"Email";font-size:20px;opacity:0}',
        '.generated{display:none}.generated::before{content:"Email";font-size:20px}',
        '.generated{opacity:0}.generated::before{content:"Email";font-size:20px}',
      ]) {
        await page.setContent(fixture(css));
        assert.deepEqual((await checkPage(page, policy)).findings, [], css);
      }
      await page.setContent(fixture('.generated::before{content:"Email";font-size:20px}'));
      assert.deepEqual((await checkPage(page, { typeRules: [{ selector: '.field-label', sizes: [16, 20] }] })).findings, []);
      const excepted = await checkPage(page, { ...policy, exceptions: [{ selector: '.generated', rules: ['font-size'], reason: 'Test separate label role.' }] });
      assert.deepEqual(excepted.findings, []);
      assert.equal(excepted.suppressed.length, 1);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('CLI fails a generated label with a prohibited size and passes the corrected page', async () => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(fixture(`.generated::before{content:attr(data-label);font-size:${req.url === '/fixed' ? 16 : 20}px}`));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const directory = await mkdtemp(join(tmpdir(), 'lintapple-generated-text-'));
  try {
    const config = join(directory, 'ui-policy.json');
    await writeFile(config, JSON.stringify(policy));
    const cli = process.env.LINTAPPLE_CLI || resolve('bin/lintapple.js');
    await assert.rejects(run(process.execPath, [cli, `${origin}/broken`, '--config', config, '--json']), error => {
      assert.equal(error.code, 1);
      const report = JSON.parse(error.stdout);
      assert.equal(report.runs.length, 4);
      assert.equal(report.findings.length, 4);
      assert.ok(report.findings.every(f => f.rule === 'font-size' && f.selector.endsWith('::before')));
      return true;
    });
    const { stdout } = await run(process.execPath, [cli, `${origin}/fixed`, '--config', config, '--json']);
    assert.deepEqual(JSON.parse(stdout).findings, []);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});
