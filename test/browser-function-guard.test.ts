import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { inspectBrowserFunctions } from './browser-function-guard.js';

async function inspect(source: string) {
  const directory = await mkdtemp(join(tmpdir(), 'lintapple-browser-functions-'));
  try {
    await writeFile(join(directory, 'helper.js'), 'export const helper = value => value;');
    await writeFile(join(directory, 'helper.d.ts'), 'export declare const helper: (value: string) => string;');
    const file = join(directory, 'index.js');
    await writeFile(file, source);
    return inspectBrowserFunctions([file]);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

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

test('compiled browser functions have no outside values', async () => {
  const directory = fileURLToPath(new URL('../src/', import.meta.url));
  const files = (await readdir(directory)).filter(file => file.endsWith('.js')).map(file => join(directory, file));
  const result = inspectBrowserFunctions(files);
  assert.ok(result.functions.length >= 7, 'No browser functions found. Check serialization discovery.');
  assert.deepEqual(result.violations, [], result.violations.join('\n'));
});
