import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { inspectBrowserFunctions } from './browser-function-guard.js';

async function inspect(source: string, extension = 'js') {
  const directory = await mkdtemp(join(tmpdir(), 'lintapple-browser-functions-'));
  try {
    await symlink(dirname(dirname(createRequire(import.meta.url).resolve('playwright/package.json'))), join(directory, 'node_modules'), 'dir');
    await writeFile(join(directory, 'helper.js'), 'export const helper = value => value;');
    await writeFile(join(directory, 'helper.d.ts'), 'export declare const helper: (value: string) => string;');
    const file = join(directory, `index.${extension}`);
    await writeFile(file, source);
    return inspectBrowserFunctions([file]);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('browser function guard checks direct Playwright callbacks and their named owners', async () => {
  const result = await inspect(`
    import { chromium } from 'playwright';
    import { helper as imported } from './helper.js';
    const page = await (await chromium.launch()).newPage();
    const outside = 'module value';
    function named() { return outside; }
    const variable = () => outside;
    await page.evaluate(named);
    await page.evaluateHandle(variable);
    await page.waitForFunction(() => outside);
    await page.locator('body').evaluateAll(elements => outside + elements.length);
    await page.evaluate(imported, 'value');
    await page.evaluate(value => ({ value, title: document.title }), 'value');
    await page.evaluateHandle(function () { return window.innerWidth; });
    await page.waitForFunction(() => document.readyState === 'complete');
    await page.evaluate('document.title');
  `);
  assert.equal(result.functions.length, 8);
  assert.equal(result.violations.length, 4, result.violations.join('\n'));
  assert.ok(result.violations.every(value => /outside value outside/.test(value)));
});

test('browser function guard leaves unrelated methods and indirect callback parameters alone', async () => {
  const result = await inspect(`
    import { chromium } from 'playwright';
    const page = await (await chromium.launch()).newPage();
    const outside = 'module value';
    const unrelated = {
      evaluate(fn) { return fn(); },
      evaluateHandle(fn) { return fn(); },
      waitForFunction(fn) { return fn(); },
      evaluateAll(fn) { return fn(); },
    };
    unrelated.evaluate(() => outside);
    unrelated.evaluateHandle(() => outside);
    unrelated.waitForFunction(() => outside);
    unrelated.evaluateAll(() => outside);
    async function forward(fn) { return page.evaluate(fn); }
  `);
  assert.deepEqual(result.functions, []);
  assert.deepEqual(result.violations, []);
});

test('typed Playwright callbacks permit imported types and reject imported runtime values', async () => {
  const result = await inspect(`
    import type { Page } from 'playwright';
    import { helper } from './helper.js';
    async function run(page: Page) {
      function identity<T extends Pick<Page, 'url'>>(value: T) { return value as Pick<Page, 'url'>; }
      await page.evaluate(identity, { url: 'example' });
      await page.evaluate(() => helper('value'));
      await page.evaluate(() => class extends helper {});
      const forward = (fn: () => boolean) => page.waitForFunction(fn);
    }
  `, 'ts');
  assert.equal(result.functions.length, 3);
  assert.equal(result.violations.length, 2, result.violations.join('\n'));
  assert.ok(result.violations.every(value => /outside value helper/.test(value)));
});

test('browser function guard rejects imported, module, outer-scope, and undefined values', async () => {
  for (const source of [
    'import { helper } from "./helper.js"; function shipped(el) { return helper(el); }',
    'import { helper as renamed } from "./helper.js"; function shipped(el) { return renamed(el); }',
    'import * as helpers from "./helper.js"; function shipped(el) { return helpers.helper(el); }',
    'const helper = el => el; function shipped(el) { return helper(el); }',
    'const value = "outside"; function shipped() { return { value }; }',
    'function enclosing(value) { const shipped = () => value; return shipped.toString(); }',
    'function shipped(el) { return missingHelper(el); }',
    'function shipped() { return process.version; }',
    'function shipped() { return import.meta.url; }',
  ]) {
    const result = await inspect(`${source}\n${source.includes('enclosing') ? '' : 'shipped.toString();'}`);
    assert.equal(result.functions.length, 1, source);
    assert.ok(result.violations.length > 0, source);
    assert.match(result.violations.join('\n'), /browser function.*outside value/i);
  }
});

test('browser function guard permits local values, recursion, properties, and browser APIs', async () => {
  const result = await inspect(`
    const label = 'outside';
    function shipped(el, fallback = document.body) {
      const label = el.textContent ?? fallback.textContent;
      const helper = value => value.trim();
      const { id: key } = el;
      return { label, key, local: helper(label), nested: () => shipped(el),
        visible: getComputedStyle(el).display !== 'none', nodes: new Set([el]),
        absent: undefined, property: el.label };
    }
    shipped.toString();
    const arrow = (value = window.innerWidth) => Math.max(value, 0);
    arrow.toString();
    const text = 'text'; text.toString();
  `);
  assert.equal(result.functions.length, 2);
  assert.deepEqual(result.violations, []);
});

test('browser function guard checks default parameters and imported serialization targets', async () => {
  const result = await inspect(`
    import { helper as shipped } from './helper.js';
    const outside = 1;
    const local = (value = outside) => value;
    shipped.toString(); local.toString();
  `);
  assert.equal(result.functions.length, 2);
  assert.equal(result.violations.length, 1);
  assert.match(result.violations[0], /outside/);
});

test('browser function guard permits local arguments, labels, and parenthesized functions', async () => {
  const result = await inspect(`
    function shipped() {
      const local = () => arguments[0];
      loop: for (let index = 0; index < 2; index++) {
        if (index) break loop;
        continue loop;
      }
      function nested() { return arguments[0]; }
      return [local(), nested(1), new.target];
    }
    (shipped).toString();
    ((value) => value).toString();
    (function (value) { return value; }).toString();
    const variable = ((value) => value);
    variable.toString();
  `);
  assert.equal(result.functions.length, 4);
  assert.deepEqual(result.violations, []);
  const outside = await inspect('function wrap() { const shipped = () => new.target; return shipped.toString(); }');
  assert.match(outside.violations.join('\n'), /outside value new.target/);
});

test('browser function guard separates local class context from captured property keys and super', async () => {
  const local = await inspect(`
    const shipped = () => {
      class Local {
        field = this;
        static { this.count = 1; }
        method() { return this; }
      }
      return new Local();
    };
    shipped.toString();
  `);
  assert.equal(local.functions.length, 1);
  assert.deepEqual(local.violations, []);
  for (const source of [
    'const shipped = () => ({ [this.key]() { return 1; } }); shipped.toString();',
    'const holder = { method() { const shipped = () => super.key; return shipped.toString(); } };',
  ]) {
    const captured = await inspect(source);
    assert.equal(captured.functions.length, 1);
    assert.equal(captured.violations.length, 1);
    assert.match(captured.violations[0], /outside value (this|super)/);
  }
});

test('browser function guard rejects module this that binds to page state in Chromium', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lintapple-browser-context-'));
  const file = join(directory, 'context.mjs');
  await writeFile(file, `
    export function local() { return arguments[0]; }
    export const captured = () => this?.value;
    local.toString(); captured.toString();
  `);
  const browser = await chromium.launch();
  try {
    const functions = await import(pathToFileURL(file).href) as { local: (value: string) => string; captured: () => unknown };
    const page = await browser.newPage();
    await page.evaluate(() => { Object.assign(window, { value: 'page value' }); });
    const local = await page.evaluateHandle<(value: string) => string>(`(${functions.local.toString()})`);
    const captured = await page.evaluateHandle<() => unknown>(`(${functions.captured.toString()})`);
    assert.equal(await page.evaluate(fn => fn('local value'), local), 'local value');
    assert.equal(functions.captured(), undefined);
    assert.equal(await page.evaluate(fn => fn(), captured), 'page value');
    const result = inspectBrowserFunctions([file]);
    assert.equal(result.functions.length, 2);
    assert.equal(result.violations.length, 1);
    assert.match(result.violations[0], /browser function captured uses outside value this/);
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('compiled browser functions have no outside values', async () => {
  const directory = fileURLToPath(new URL('../src/', import.meta.url));
  const files = (await readdir(directory)).filter(file => file.endsWith('.js')).map(file => join(directory, file));
  const result = inspectBrowserFunctions(files);
  assert.ok(result.functions.length >= 7, 'No browser functions found. Check serialization discovery.');
  assert.deepEqual(result.violations, [], result.violations.join('\n'));
});

test('typed source checks Playwright callbacks before type imports are erased', async () => {
  const directory = fileURLToPath(new URL('../../src/', import.meta.url));
  const files = (await readdir(directory)).filter(file => file.endsWith('.ts')).map(file => join(directory, file));
  const result = inspectBrowserFunctions(files, { serialized: false });
  assert.ok(result.functions.some(value => value.endsWith(' audit')), 'The direct audit callback was not checked.');
  assert.ok(result.functions.some(value => /svg-contrast\.ts:.*value =>/.test(value)), 'The handle callback was not checked.');
  assert.deepEqual(result.violations, [], result.violations.join('\n'));
});
