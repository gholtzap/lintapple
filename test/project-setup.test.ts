import { assertProcessError } from './assert-process-error.js';
import type { UrlReport } from '../src/types.js';
import type { PlaywrightReport } from './types.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const run = promisify(execFile);

test('an existing project installs the package, keeps its files, and uses one policy in CLI and Playwright', async () => {
  await mkdir('test-results', { recursive: true });
  const root = await mkdtemp(resolve('test-results/project setup-'));
  const command = (args: string[]) => run(process.execPath, [join(root, 'node_modules/lintapple/dist/bin/lintapple.js'), ...args], { cwd: root });
  const failure = async (args: string[]) => {
    try { await command(args); assert.fail('The command must fail.'); }
    catch (error) { assertProcessError(error); assert.equal(error.code, 2, error.stderr); return error; }
  };
  try {
    const packed: {filename: string; integrity: string} = JSON.parse((await run('npm', ['pack', '--silent', '--json', '--pack-destination', root])).stdout)[0];
    const original = { name: 'existing-project', private: true, type: 'module', scripts: { dev: 'node app.js', test: 'playwright test' } };
    await writeFile(join(root, 'package.json'), JSON.stringify(original));
    await run('npm', ['install', '--no-audit', '--no-fund', join(root, packed.filename)], { cwd: root });
    await writeFile(join(root, 'consumer.ts'), `
import { checkPage, checkUrl, checkInteractions } from 'lintapple';
import type { PageReport, UrlReport, Policy } from 'lintapple';
import { expectUI } from 'lintapple/playwright';
import type { Page } from 'playwright';
import type { TestInfo } from 'playwright/test';
export function check(page: Page, info: TestInfo) {
  const policy: Partial<Policy> = { colorSchemes: ['light', 'dark'] };
  const result: Promise<PageReport> = checkPage(page, policy);
  const url: Promise<UrlReport> = checkUrl('https://example.test', policy);
  expectUI(page, info, policy);
  // @ts-expect-error A fill action needs its value.
  checkInteractions(page, {states: [{name: 'Filled', action: 'fill', selector: '#name', ready: {selector: '#result'}}]});
  // @ts-expect-error Findings do not have arbitrary fields.
  result.then(report => report.findings[0].missing);
  return {result, url};
}
`);
    await run(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--strict', '--noEmit', '--target', 'ES2023', '--module', 'NodeNext', join(root, 'consumer.ts')]);
    await command(['init']);
    const pkg: {scripts: Record<string, string>} = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts['lint:ui'], 'lintapple http://localhost:3000');
    assert.equal(pkg.scripts.dev, original.scripts.dev);
    assert.equal(pkg.scripts.test, original.scripts.test);
    const policy: import('../src/types.js').Policy = JSON.parse(await readFile(join(root, 'ui-policy.json'), 'utf8'));
    policy.fonts = ['Arial'];
    policy.fontSizes = [17];
    const policySource = JSON.stringify(policy);
    await writeFile(join(root, 'ui-policy.json'), policySource);
    await writeFile(join(root, 'app.html'), '<!doctype html><html lang="en"><style>html{background:#fff;color:#202020;font:17px Arial}body{margin:24px}</style><body><p>Projects</p></body></html>');
    const url = pathToFileURL(join(root, 'app.html')).href;
    pkg.scripts['lint:ui'] = `lintapple ${JSON.stringify(url)}`;
    await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
    const before = await readFile(join(root, 'package.json'), 'utf8');
    await command(['init']);
    assert.equal(await readFile(join(root, 'package.json'), 'utf8'), before);
    assert.equal(await readFile(join(root, 'ui-policy.json'), 'utf8'), policySource);
    const cli: UrlReport = JSON.parse((await run('npm', ['run', '--silent', 'lint:ui', '--', '--json'], { cwd: root })).stdout);
    assert.deepEqual(cli.findings, []);
    assert.equal(cli.runs.length, 2);
    await writeFile(join(root, 'ui-policy.json'), '{');
    const invalid = await failure([url]);
    assert.match(invalid.stderr, /JSON/);
    const badSource = await readFile(join(root, 'ui-policy.json'), 'utf8');
    await failure(['init']);
    assert.equal(await readFile(join(root, 'ui-policy.json'), 'utf8'), badSource);
    assert.equal(await readFile(join(root, 'package.json'), 'utf8'), before);
    await writeFile(join(root, 'chosen.json'), policySource);
    assert.deepEqual(JSON.parse((await command([url, '--config', 'chosen.json', '--json'])).stdout).findings, []);
    assert.match((await failure([url, '--config', 'absent.json'])).stderr, /Cannot find "absent\.json"/);
    await writeFile(join(root, 'ui-policy.json'), policySource);
    await writeFile(join(root, 'playwright.config.js'), `export default { testMatch: 'adoption.spec.js', workers: 1, reporter: [['json', {outputFile: 'results.json'}]], use: {viewport: {width: 390, height: 844}} };`);
    await writeFile(join(root, 'adoption.spec.js'), `
import { test } from 'playwright/test';
import { expectUI } from 'lintapple/playwright';
import { writeFile } from 'node:fs/promises';
test('project policy', async ({page}, info) => {
  await page.goto(${JSON.stringify(url)});
  await expectUI(page, info);
});
test('explicit policy replaces project policy', async ({page}, info) => {
  await page.goto(${JSON.stringify(url)});
  await page.locator('html').evaluate(el => {el.style.fontFamily = 'system-ui';el.style.fontSize = '16px';});
  await expectUI(page, info, {});
});
test('invalid project policy fails', async ({page}, info) => {
  await page.goto(${JSON.stringify(url)});
  await writeFile('ui-policy.json', '{');
  await expectUI(page, info);
});
`);
    await assert.rejects(run(process.execPath, [join(root, 'node_modules/playwright/cli.js'), 'test'], { cwd: root }), error => error instanceof Error && 'code' in error && error.code === 1);
    const report: PlaywrightReport = JSON.parse(await readFile(join(root, 'results.json'), 'utf8'));
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.suites[0].specs.map(spec => [spec.title, spec.ok]), [['project policy', true], ['explicit policy replaces project policy', true], ['invalid project policy fails', false]]);
    assert.match(report.suites[0].specs[2].tests[0].results[0].errors[0].message, /JSON/);
    await rm(join(root, 'ui-policy.json'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ ...original, scripts: [] }));
    assert.match((await failure(['init'])).stderr, /scripts must be an object/);
    await assert.rejects(readFile(join(root, 'ui-policy.json')), error => error instanceof Error && 'code' in error && error.code === 'ENOENT');
    await failure(['init', '--overwrite']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
