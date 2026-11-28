import { test } from 'node:test';
import type { SourceReport } from '../src/source.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertProcessError } from './assert-process-error.js';

const execute = promisify(execFile);

test('installed source command checks real design rules and reports incomplete coverage', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'lintapple-source-'));
  const records: unknown[] = [];
  const localCli = resolve('dist/bin/lintapple.js');
  let cli = localCli;
  async function run(args: string[], expectedCode: number) {
    let result: { stdout: string; stderr: string; code: number };
    try { result = { ...await execute(process.execPath, [cli, ...args], { cwd }), code: 0 }; }
    catch (error) { assertProcessError(error); result = { stdout: error.stdout, stderr: error.stderr, code: Number(error.code) }; }
    records.push({ args, ...result });
    assert.equal(result.code, expectedCode, result.stdout + result.stderr);
    return result;
  }
  try {
    await writeFile(join(cwd, 'package.json'), '{"private":true,"type":"module"}');
    assert.match((await run(['source'], 2)).stderr, /Install ESLint/);
    await cp(resolve('examples/source'), cwd, { recursive: true });
    const packed: { filename: string }[] = JSON.parse((await execute('npm', ['pack', '--ignore-scripts', '--silent', '--json', '--pack-destination', cwd])).stdout);
    await execute('npm', ['install', '--no-audit', '--no-fund', join(cwd, packed[0].filename)], { cwd });
    cli = join(cwd, 'node_modules/lintapple/dist/bin/lintapple.js');
    const defaults: SourceReport = JSON.parse((await run(['source', '--json'], 1)).stdout);
    assert.equal(defaults.files.length, 5);
    assert.ok(defaults.skipped.some(file => file.path === 'eslint.config.mjs'));
    const before = await readFile(join(cwd, 'src/bad.tsx'), 'utf8');
    const config = await readFile(join(cwd, 'eslint.config.mjs'), 'utf8');
    const bad: SourceReport = JSON.parse((await run(['source', 'src/bad.tsx', '--json'], 1)).stdout);
    assert.equal(bad.status, 'failed');
    assert.equal(bad.engine.designPlugin.version, '0.2.5');
    assert.equal(bad.files[0].theme, 'src/theme.css');
    assert.equal(bad.files[0].config, 'eslint.config.mjs');
    assert.deepEqual(bad.diagnostics, []);
    assert.match((await run(['source', 'src/bad.tsx'], 1)).stdout, /Suggestions need a browser check/);
    assert.equal(bad.files.length, 1);
    assert.equal(bad.files[0].rules.length, 3);
    assert.ok(bad.findings.some(f => f.ruleId === 'shadcn/no-raw-colors'));
    assert.ok(bad.findings.some(f => f.ruleId === 'shadcn/no-arbitrary-values'));
    assert.ok(bad.findings.every(f => f.line > 0 && f.column > 0 && f.message));
    assert.match((await run(['source', 'src/bad.tsx'], 1)).stdout, /src\/bad.tsx:2:\d+/);
    const good: SourceReport = JSON.parse((await run(['source', 'src/good.tsx', '--json'], 0)).stdout);
    assert.equal(good.status, 'passed');
    assert.deepEqual(good.findings, []);
    assert.equal(await readFile(join(cwd, 'src/bad.tsx'), 'utf8'), before);
    assert.equal(await readFile(join(cwd, 'eslint.config.mjs'), 'utf8'), config);
    // Both parsers enforce the same component contract through the installed CLI.
    const vue: SourceReport = JSON.parse((await run(['source', 'src/bad.vue', '--json'], 1)).stdout);
    assert.ok(vue.findings.some(f => f.ruleId === 'shadcn/no-restyle' && f.message.includes('px-8')));
    await run(['source', 'src/good.vue'], 0);
    // Select the app's entry point even when another stylesheet has more tokens.
    await writeFile(join(cwd, 'components.json'), JSON.stringify({ tailwind: { css: 'src/theme.css' }, aliases: { ui: './src/ui' } }));
    await writeFile(join(cwd, 'src/other.css'), '@import "tailwindcss"; @theme { --color-other: red; --color-another: blue; }');
    const selected: SourceReport = JSON.parse((await run(['source', 'src/good.tsx', '--json'], 0)).stdout);
    assert.equal(selected.files[0].theme, 'src/theme.css');
    // Upstream fallback warnings must be visible in JSON and must not pass.
    await writeFile(join(cwd, 'components.json'), JSON.stringify({ tailwind: { css: 'missing.css' }, aliases: { ui: './src/ui' } }));
    const missingTheme: SourceReport = JSON.parse((await run(['source', 'src/good.tsx', '--json'], 2)).stdout);
    assert.equal(missingTheme.status, 'incomplete');
    assert.ok(missingTheme.diagnostics.some(message => message.includes('missing.css')));
    await rm(join(cwd, 'components.json'));
    await rm(join(cwd, 'src/other.css'));
    await rm(join(cwd, 'src/theme.css'));
    const noTheme: SourceReport = JSON.parse((await run(['source', 'src/good.tsx', '--json'], 2)).stdout);
    assert.ok(noTheme.errors.some(message => message.includes('No theme')));
    await writeFile(join(cwd, 'src/theme.css'), '@import "tailwindcss"; @theme { --color-primary: #21201c; }');
    const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
    if (nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 13)) {
      await execute('npm', ['install', '--no-save', '--no-audit', '--no-fund', 'eslint@10.15.0'], { cwd });
      const newer: SourceReport = JSON.parse((await run(['source', 'src/bad.tsx', '--json'], 1)).stdout);
      assert.equal(newer.engine.version, '10.15.0');
      assert.equal(newer.findings.length, bad.findings.length);
      await run(['source', 'src/bad.vue'], 1);
    }
    await execute('npm', ['install', '--no-save', '--no-audit', '--no-fund', 'eslint@9.39.5'], { cwd });
    const older: SourceReport = JSON.parse((await run(['source', 'src/bad.tsx', '--json'], 1)).stdout);
    assert.equal(older.engine.version, '9.39.5');
    assert.equal(older.findings.length, bad.findings.length);
    await run(['source', 'src/missing.tsx'], 2);
    await run(['source', '--fix'], 2);
    await run(['source', '--config'], 2);
    await writeFile(join(cwd, 'src/syntax.tsx'), 'export function {');
    const syntax: SourceReport = JSON.parse((await run(['source', 'src/syntax.tsx', '--json'], 2)).stdout);
    assert.equal(syntax.status, 'incomplete');
    assert.ok(syntax.findings.some(f => f.fatal));
    await writeFile(join(cwd, 'src/unused.tsx'), 'const unused = <div className="bg-primary p-4" />;');
    await writeFile(join(cwd, 'alternate.mjs'), config.replace("rules: {", "rules: { 'no-unused-vars': 'error',"));
    await run(['source', 'src/unused.tsx', '--config', 'alternate.mjs'], 0);
    await writeFile(join(cwd, 'alternate.mjs'), config.replaceAll("'error'", "'warn'"));
    const warnings: SourceReport = JSON.parse((await run(['source', 'src/bad.tsx', '--config', 'alternate.mjs', '--json'], 1)).stdout);
    assert.ok(warnings.findings.every(f => f.severity === 1));
    await writeFile(join(cwd, 'eslint.config.mjs'), `export default [{files: ['src/**/*.tsx'], languageOptions: {parserOptions: {ecmaFeatures: {jsx: true}}}, rules: {'no-unused-vars': 'error'}}];`);
    const uncovered: SourceReport = JSON.parse((await run(['source', 'src/good.tsx', '--json'], 2)).stdout);
    assert.equal(uncovered.status, 'incomplete');
    assert.deepEqual(uncovered.files, []);
    assert.ok(uncovered.skipped.length);
    await writeFile(join(cwd, 'eslint.config.mjs'), `export default [{ignores: ['src/**']}];`);
    await run(['source', 'src/good.tsx'], 2);
    await writeFile(join(cwd, 'eslint.config.mjs'), 'invalid configuration!');
    await run(['source', 'src/good.tsx'], 2);
    await rm(join(cwd, 'eslint.config.mjs'));
    await run(['source', 'src/good.tsx'], 2);
    // URL help remains available with the source integration installed.
    assert.match((await run(['--help'], 0)).stdout, /lintapple <url>/);
  } finally {
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/source-cli.json', JSON.stringify({ environment: { node: process.version }, records }, null, 2));
    await rm(cwd, { recursive: true, force: true });
  }
});
