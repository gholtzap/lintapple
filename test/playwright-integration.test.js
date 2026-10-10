import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { resolve, join } from 'node:path';

const run = promisify(execFile);

test('packed assertion uses Playwright HTML attachments and GitHub error annotations', async () => {
  await mkdir('test-results', { recursive: true });
  const directory = await mkdtemp(resolve('test-results/playwright-integration-'));
  try {
    const packed = JSON.parse((await run('npm', ['pack', '--json', '--pack-destination', directory])).stdout)[0];
    await run('tar', ['-xzf', join(directory, packed.filename), '-C', directory]);
    const root = join(directory, 'package');
    await writeFile(join(root, 'checks.spec.js'), `
import { test } from 'playwright/test';
import { expectUI } from 'lintapple/playwright';
const good = new URL('./examples/good.html', import.meta.url).href;
test('valid page', async ({ page }, testInfo) => {
  await page.goto(good);
  await expectUI(page, testInfo);
});
test('invalid page', async ({ page }, testInfo) => {
  await page.goto(good);
  await page.locator('button').first().evaluate(el => el.style.fontSize = '11px');
  await expectUI(page, testInfo);
});
test('invalid policy', async ({ page }, testInfo) => {
  await page.goto(good);
  await expectUI(page, testInfo, { fontSizes: [] });
});
test('corrected page', async ({ page }, testInfo) => {
  await page.goto(good);
  await page.locator('button').first().evaluate(el => el.style.fontSize = '11px');
  try { await expectUI(page, testInfo); } catch {}
  await page.locator('button').first().evaluate(el => el.style.fontSize = '16px');
  await expectUI(page, testInfo);
});
`);
    await writeFile(join(root, 'playwright.config.js'), `export default {
  testDir: '.', testMatch: 'checks.spec.js', workers: 1, retries: 0,
  use: { viewport: { width: 390, height: 844 } },
  outputDir: './results',
  reporter: [['json', { outputFile: './results.json' }], ['html', { outputFolder: './html-report', open: 'never' }], ['github']],
};`);
    let output;
    try { await run(process.execPath, [resolve('node_modules/playwright/cli.js'), 'test'], { cwd: root, env: { ...process.env, FORCE_COLOR: '0', GITHUB_ACTIONS: 'true' } }); }
    catch (error) { assert.equal(error.code, 1, error.stderr || error.stdout); output = error.stdout; }
    assert.ok(output, 'The two invalid tests must fail.');
    const report = JSON.parse(await readFile(join(root, 'results.json'), 'utf8'));
    await writeFile('test-results/playwright-integration-results.json', JSON.stringify(report, null, 2));
    await writeFile('test-results/playwright-integration-output.txt', output);
    assert.deepEqual(report.errors, []);
    const tests = report.suites[0].specs;
    assert.deepEqual(tests.map(spec => [spec.title, spec.ok]), [['valid page', true], ['invalid page', false], ['invalid policy', false], ['corrected page', true]]);
    const passed = tests[0].tests[0].results[0];
    assert.deepEqual(passed.attachments, []);
    const failed = tests[1].tests[0].results[0];
    const attachments = failed.attachments.filter(item => item.name === 'lintapple findings');
    assert.equal(attachments.length, 1);
    const attachment = attachments[0];
    assert.equal(attachment.name, 'lintapple findings');
    assert.equal(attachment.contentType, 'application/json');
    const findings = JSON.parse(attachment.body ? Buffer.from(attachment.body, 'base64').toString() : await readFile(attachment.path, 'utf8'));
    assert.ok(findings.findings.some(f => f.rule === 'font-size' && f.selector && f.actual && f.expected && f.fix));
    assert.equal(findings.url, new URL(`file://${join(root, 'examples/good.html')}`).href);
    assert.deepEqual(findings.viewport, { width: 390, height: 844 });
    assert.match(failed.errors[0].message, /font-size[\s\S]*Expected[\s\S]*Found[\s\S]*Fix:/);
    assert.match(output, /::error file=checks\.spec\.js,[^\n]*line=12,col=3::/);
    assert.match(output, /font-size/);
    assert.equal(tests[2].tests[0].results[0].attachments.filter(item => item.name === 'lintapple findings').length, 0);
    assert.match(tests[2].tests[0].results[0].errors[0].message, /fontSizes must be a nonempty list/);
    const html = await readFile(join(root, 'html-report/index.html'), 'utf8');
    assert.match(html, /Playwright Test Report/);
    await mkdir('test-results/playwright-integration-report', { recursive: true });
    const { cp } = await import('node:fs/promises');
    await cp(join(root, 'html-report'), 'test-results/playwright-integration-report', { recursive: true });
    await writeFile('test-results/playwright-integration-receipt.json', JSON.stringify({ package: packed.filename, integrity: packed.integrity, tests: tests.map(spec => ({ title: spec.title, passed: spec.ok })), annotation: output.match(/::error[^\n]+font-size[^\n]*/), attachment: findings }, null, 2));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
